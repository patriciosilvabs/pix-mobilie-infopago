import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AppRole, Profile, Company, CompanyMember } from "@/types/database";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  companies: Company[];
  currentCompany: Company | null;
  companyMembership: CompanyMember | null;
  pagePermissions: string[];
  featurePermissions: string[];
  canViewBalance: boolean;
  isAdmin: boolean;
  isOperator: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  setCurrentCompany: (company: Company) => void;
  refreshProfile: () => Promise<void>;
  hasPageAccess: (pageKey: string) => boolean;
  hasFeatureAccess: (featureKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(null);
  const [companyMembership, setCompanyMembership] = useState<CompanyMember | null>(null);
  const [pagePermissions, setPagePermissions] = useState<string[]>([]);
  const [featurePermissions, setFeaturePermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = role === "admin";
  const isOperator = role === "operator";
  const canViewBalance = companyMembership?.can_view_balance ?? isAdmin;

  // isLoading must remain true until permissions are fully loaded for authenticated users
  const effectiveIsLoading = isLoading || (!!user && !permissionsLoaded);

  const fetchInProgressRef = React.useRef(false);
  const loadedUserIdRef = React.useRef<string | null>(null);

  const fetchUserData = useCallback(async (userId: string, force = false) => {
    // Skip if data already loaded for this user (prevents re-fetch on TOKEN_REFRESHED)
    if (!force && loadedUserIdRef.current === userId) return;
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;
    setPermissionsLoaded(false);
    try {
      // Fetch profile
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (profileData) {
        setProfile(profileData as Profile);
      }

      // Fetch role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();

      if (roleData) {
        setRole(roleData.role as AppRole);
      }

      // Fetch companies
      const { data: companiesData } = await supabase
        .from("companies")
        .select("*")
        .eq("is_active", true);

      if (companiesData && companiesData.length > 0) {
        setCompanies(companiesData as Company[]);
        
        // Get saved company or use first one
        const savedCompanyId = localStorage.getItem("currentCompanyId");
        const savedCompany = companiesData.find((c) => c.id === savedCompanyId);
        const companyToSet = savedCompany || companiesData[0];
        setCurrentCompanyState(companyToSet as Company);

        // Fetch membership for current company
        const { data: membershipData } = await supabase
          .from("company_members")
          .select("*")
          .eq("user_id", userId)
          .eq("company_id", companyToSet.id)
          .eq("is_active", true)
          .single();

        if (membershipData) {
          setCompanyMembership(membershipData as CompanyMember);
        }

        // Fetch page permissions for current company
        const { data: permData } = await supabase
          .from("user_page_permissions")
          .select("page_key")
          .eq("user_id", userId)
          .eq("company_id", companyToSet.id)
          .eq("has_access", true);

        if (permData) {
          setPagePermissions(permData.map((p: any) => p.page_key));
        }

        // Fetch feature permissions for current company
        const { data: featData } = await supabase
          .from("user_feature_permissions")
          .select("feature_key")
          .eq("user_id", userId)
          .eq("company_id", companyToSet.id)
          .eq("is_visible", true);

        if (featData) {
          setFeaturePermissions(featData.map((f: any) => f.feature_key));
        } else {
          setFeaturePermissions([]);
        }
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    } finally {
      setPermissionsLoaded(true);
      loadedUserIdRef.current = userId;
      fetchInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        // Defer Supabase calls with setTimeout
        if (session?.user) {
          setTimeout(() => {
            fetchUserData(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRole(null);
          setCompanies([]);
          setCurrentCompanyState(null);
          setCompanyMembership(null);
        }

        if (event === "SIGNED_OUT") {
          localStorage.removeItem("currentCompanyId");
          loadedUserIdRef.current = null;
        }

        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchUserData]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const setCurrentCompany = (company: Company) => {
    setCurrentCompanyState(company);
    localStorage.setItem("currentCompanyId", company.id);
    
    // Refresh membership for new company
    if (user) {
      supabase
        .from("company_members")
        .select("*")
        .eq("user_id", user.id)
        .eq("company_id", company.id)
        .eq("is_active", true)
        .single()
        .then(({ data }) => {
          if (data) {
            setCompanyMembership(data as CompanyMember);
          }
        });
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserData(user.id, true);
    }
  };

  const hasPageAccess = useCallback((pageKey: string): boolean => {
    if (!permissionsLoaded) return false;
    if (isAdmin) return true;
    return pagePermissions.includes(pageKey);
  }, [isAdmin, pagePermissions, permissionsLoaded]);

  const hasFeatureAccess = useCallback((featureKey: string): boolean => {
    if (!permissionsLoaded) return false;
    if (isAdmin) return true;
    if (featurePermissions.length === 0) return true;
    return featurePermissions.includes(featureKey);
  }, [isAdmin, featurePermissions, permissionsLoaded]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role,
        companies,
        currentCompany,
        companyMembership,
        pagePermissions,
        featurePermissions,
        canViewBalance,
        isAdmin,
        isOperator,
        isLoading: effectiveIsLoading,
        signIn,
        signUp,
        signOut,
        setCurrentCompany,
        refreshProfile,
        hasPageAccess,
        hasFeatureAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
