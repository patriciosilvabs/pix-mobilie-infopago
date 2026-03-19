import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { getIdToken } from "firebase/auth";
import { firebaseApp } from "@/integrations/firebase/client";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
  token_type: string;
}

type QueryFilter = {
  field: string;
  op: "eq" | "gte" | "lte" | "not_is_null";
  value: unknown;
};

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

function mapUser(user: FirebaseUser): AuthUser {
  return {
    id: user.uid,
    email: user.email,
  };
}

async function buildSession(user: FirebaseUser | null): Promise<AuthSession | null> {
  if (!user) return null;
  const token = await getIdToken(user);
  return {
    user: mapUser(user),
    access_token: token,
    token_type: "bearer",
  };
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function applyFilters(rows: Record<string, unknown>[], filters: QueryFilter[]): Record<string, unknown>[] {
  return rows.filter((row) => {
    return filters.every((filter) => {
      const value = row[filter.field];
      if (filter.op === "eq") return value === filter.value;
      if (filter.op === "not_is_null") return value !== null && value !== undefined;
      if (filter.op === "gte") return compareValues(value, filter.value) >= 0;
      return compareValues(value, filter.value) <= 0;
    });
  });
}

async function enrichTransactionRows(rows: Record<string, unknown>[], selectColumns?: string) {
  const needsCategories = !!selectColumns && selectColumns.includes("categories(");
  const needsReceipts = !!selectColumns && selectColumns.includes("receipts(");

  if (!needsCategories && !needsReceipts) return rows;

  let categoryMap = new Map<string, Record<string, unknown>>();
  if (needsCategories) {
    const categorySnap = await getDocs(collection(db, "categories"));
    categoryMap = new Map(
      categorySnap.docs.map((d) => {
        const data = d.data();
        return [d.id, { id: d.id, ...data } as Record<string, unknown>];
      })
    );
  }

  let receiptsByTransaction = new Map<string, Record<string, unknown>[]>();
  if (needsReceipts) {
    const receiptSnap = await getDocs(collection(db, "receipts"));
    for (const receiptDoc of receiptSnap.docs) {
      const receipt = { id: receiptDoc.id, ...receiptDoc.data() } as Record<string, unknown>;
      const txId = String(receipt.transaction_id ?? "");
      if (!txId) continue;
      const list = receiptsByTransaction.get(txId) ?? [];
      list.push(receipt);
      receiptsByTransaction.set(txId, list);
    }
  }

  return rows.map((row) => {
    const next = { ...row };
    if (needsCategories) {
      const categoryId = String(row.category_id ?? "");
      next.categories = categoryId ? categoryMap.get(categoryId) ?? null : null;
    }
    if (needsReceipts) {
      const txId = String(row.id ?? "");
      next.receipts = receiptsByTransaction.get(txId) ?? [];
    }
    return next;
  });
}

class QueryBuilder implements PromiseLike<{ data: any; error: Error | null }> {
  private readonly table: string;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private selectColumns: string | undefined;
  private payload: any;
  private filters: QueryFilter[] = [];
  private orderField: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;
  private expectSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  select(columns = "*") {
    this.mode = "select";
    this.selectColumns = columns;
    return this;
  }

  insert(values: any) {
    this.mode = "insert";
    this.payload = values;
    return this;
  }

  update(values: any) {
    this.mode = "update";
    this.payload = values;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, op: "eq", value });
    return this;
  }

  gte(field: string, value: unknown) {
    this.filters.push({ field, op: "gte", value });
    return this;
  }

  lte(field: string, value: unknown) {
    this.filters.push({ field, op: "lte", value });
    return this;
  }

  not(field: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push({ field, op: "not_is_null", value: null });
    }
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this;
  }

  async execute(): Promise<{ data: any; error: Error | null }> {
    try {
      const collectionRef = collection(db, this.table);

      if (this.mode === "select") {
        const snapshot = await getDocs(collectionRef);
        let rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));

        rows = applyFilters(rows, this.filters);

        if (this.table === "transactions") {
          rows = await enrichTransactionRows(rows, this.selectColumns);
        }

        if (this.orderField) {
          const field = this.orderField;
          const direction = this.orderAscending ? 1 : -1;
          rows.sort((a, b) => compareValues(a[field], b[field]) * direction);
        }

        if (this.limitCount != null) {
          rows = rows.slice(0, this.limitCount);
        }

        const data = this.expectSingle ? (rows[0] ?? null) : rows;
        return { data, error: null };
      }

      if (this.mode === "insert") {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted: DocumentData[] = [];

        for (const item of items) {
          const record = { ...item } as Record<string, unknown>;
          const providedId = typeof record.id === "string" ? record.id : null;
          if (providedId) {
            const { id: _, ...withoutId } = record;
            await setDoc(doc(collectionRef, providedId), withoutId);
            inserted.push({ id: providedId, ...withoutId });
          } else {
            const docRef = await addDoc(collectionRef, record);
            inserted.push({ id: docRef.id, ...record });
          }
        }

        const data = this.expectSingle ? inserted[0] ?? null : inserted;
        return { data, error: null };
      }

      const snapshot = await getDocs(collectionRef);
      let rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      rows = applyFilters(rows, this.filters);

      if (this.mode === "update") {
        for (const row of rows) {
          await updateDoc(doc(collectionRef, String(row.id)), this.payload);
        }
        return { data: this.expectSingle ? rows[0] ?? null : rows, error: null };
      }

      for (const row of rows) {
        await deleteDoc(doc(collectionRef, String(row.id)));
      }
      return { data: this.expectSingle ? rows[0] ?? null : rows, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  then<TResult1 = { data: any; error: Error | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: Error | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

const supabaseFunctionsUrl = (
  import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    : (import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL ||
       `https://us-central1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`)
).replace(/\/$/, "");

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const supabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  auth: {
    async getSession() {
      return { data: { session: await buildSession(auth.currentUser) }, error: null };
    },
    async getUser() {
      return { data: { user: auth.currentUser ? mapUser(auth.currentUser) : null }, error: null };
    },
    onAuthStateChange(callback: (event: string, session: AuthSession | null) => void) {
      let previousUserId: string | null = auth.currentUser?.uid ?? null;
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        const currentUserId = user?.uid ?? null;
        let event = "TOKEN_REFRESHED";
        if (!previousUserId && currentUserId) event = "SIGNED_IN";
        if (previousUserId && !currentUserId) event = "SIGNED_OUT";
        previousUserId = currentUserId;
        callback(event, await buildSession(user));
      });

      return { data: { subscription: { unsubscribe } } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        if (options?.data?.full_name) {
          await updateProfile(credential.user, { displayName: options.data.full_name });
        }
        return { data: { user: mapUser(credential.user) }, error: null };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },
    async updateUser({ password }: { password?: string }) {
      if (!auth.currentUser || !password) {
        return { data: null, error: new Error("Usuario nao autenticado ou senha invalida.") };
      }
      try {
        await updatePassword(auth.currentUser, password);
        return { data: null, error: null };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },
    async signOut() {
      await firebaseSignOut(auth);
      return { error: null };
    },
  },
  functions: {
    async invoke(name: string, options?: { body?: unknown; headers?: Record<string, string> }) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(options?.headers ?? {}),
        };

        // Use Supabase anon key for apikey header
        if (supabaseAnonKey) {
          headers["apikey"] = supabaseAnonKey;
        }

        if (!headers.Authorization && auth.currentUser) {
          const token = await getIdToken(auth.currentUser);
          headers.Authorization = `Bearer ${token}`;
        }

        // Call Supabase Edge Functions directly (keep kebab-case name)
        const fullUrl = `${supabaseFunctionsUrl}/${name}`;
        const response = await fetch(fullUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(options?.body ?? {}),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          return {
            data: null,
            error: {
              message: payload?.error || payload?.message || `Function ${name} failed with status ${response.status}`,
              context: { json: async () => payload },
            },
          };
        }

        return { data: payload, error: null };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },
  },
  storage: {
    from(bucket: string) {
      return {
        async upload(path: string, file: Blob) {
          try {
            await uploadBytes(ref(storage, `${bucket}/${path}`), file);
            return { data: { path }, error: null };
          } catch (error) {
            return { data: null, error: error as Error };
          }
        },
        async remove(paths: string[]) {
          try {
            await Promise.all(paths.map(async (path) => deleteObject(ref(storage, `${bucket}/${path}`)).catch(() => undefined)));
            return { data: null, error: null };
          } catch (error) {
            return { data: null, error: error as Error };
          }
        },
        async createSignedUrl(path: string, _expiresIn: number) {
          try {
            const signedUrl = await getDownloadURL(ref(storage, `${bucket}/${path}`));
            return { data: { signedUrl }, error: null };
          } catch (error) {
            return { data: null, error: error as Error };
          }
        },
      };
    },
  },
};



