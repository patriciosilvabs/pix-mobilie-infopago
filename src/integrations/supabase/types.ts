export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          agency: string | null
          balance: number
          bank_name: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          pix_key: string | null
          pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          agency?: string | null
          balance?: number
          bank_name: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          agency?: string | null
          balance?: number
          bank_name?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          classification: Database["public"]["Enums"]["classification_type"]
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string[] | null
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          classification: Database["public"]["Enums"]["classification_type"]
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[] | null
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          classification?: Database["public"]["Enums"]["classification_type"]
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[] | null
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          cnpj: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          can_view_balance: boolean
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          payment_limit: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          can_view_balance?: boolean
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          payment_limit?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          can_view_balance?: boolean
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          payment_limit?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pix_configs: {
        Row: {
          base_url: string
          certificate_cash_in: string | null
          certificate_cash_out: string | null
          certificate_encrypted: string | null
          certificate_key_cash_in: string | null
          certificate_key_cash_out: string | null
          certificate_key_encrypted: string | null
          client_id: string
          client_secret_encrypted: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean | null
          is_sandbox: boolean | null
          pix_key: string
          pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          provider: string
          provider_company_id: string | null
          purpose: Database["public"]["Enums"]["pix_config_purpose"]
          updated_at: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          base_url: string
          certificate_cash_in?: string | null
          certificate_cash_out?: string | null
          certificate_encrypted?: string | null
          certificate_key_cash_in?: string | null
          certificate_key_cash_out?: string | null
          certificate_key_encrypted?: string | null
          client_id: string
          client_secret_encrypted: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_sandbox?: boolean | null
          pix_key: string
          pix_key_type: Database["public"]["Enums"]["pix_key_type"]
          provider: string
          provider_company_id?: string | null
          purpose?: Database["public"]["Enums"]["pix_config_purpose"]
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          base_url?: string
          certificate_cash_in?: string | null
          certificate_cash_out?: string | null
          certificate_encrypted?: string | null
          certificate_key_cash_in?: string | null
          certificate_key_cash_out?: string | null
          certificate_key_encrypted?: string | null
          client_id?: string
          client_secret_encrypted?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_sandbox?: boolean | null
          pix_key?: string
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"]
          provider?: string
          provider_company_id?: string | null
          purpose?: Database["public"]["Enums"]["pix_config_purpose"]
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pix_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pix_refunds: {
        Row: {
          created_at: string
          created_by: string | null
          e2eid: string
          error_code: string | null
          error_message: string | null
          id: string
          motivo: string | null
          refund_id: string
          refunded_at: string | null
          status: string
          transaction_id: string
          valor: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          e2eid: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          motivo?: string | null
          refund_id: string
          refunded_at?: string | null
          status?: string
          transaction_id: string
          valor: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          e2eid?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          motivo?: string | null
          refund_id?: string
          refunded_at?: string | null
          status?: string
          transaction_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pix_refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pix_tokens: {
        Row: {
          access_token: string
          company_id: string
          created_at: string
          expires_at: string
          id: string
          pix_config_id: string | null
          token_type: string | null
        }
        Insert: {
          access_token: string
          company_id: string
          created_at?: string
          expires_at: string
          id?: string
          pix_config_id?: string | null
          token_type?: string | null
        }
        Update: {
          access_token?: string
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          pix_config_id?: string | null
          token_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pix_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pix_tokens_pix_config_id_fkey"
            columns: ["pix_config_id"]
            isOneToOne: false
            referencedRelation: "pix_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pix_tokens_pix_config_id_fkey"
            columns: ["pix_config_id"]
            isOneToOne: false
            referencedRelation: "pix_configs_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pix_webhook_logs: {
        Row: {
          company_id: string | null
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          ip_address: string | null
          payload: Json
          processed: boolean | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          payload: Json
          processed?: boolean | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          payload?: Json
          processed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pix_webhook_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          capture_latitude: number | null
          capture_longitude: number | null
          capture_timestamp: string | null
          created_at: string
          device_info: Json | null
          extracted_access_key: string | null
          extracted_cnpj: string | null
          extracted_date: string | null
          extracted_value: number | null
          file_name: string | null
          file_type: string | null
          file_url: string
          id: string
          ocr_data: Json | null
          ocr_status: Database["public"]["Enums"]["receipt_status"]
          transaction_id: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          capture_latitude?: number | null
          capture_longitude?: number | null
          capture_timestamp?: string | null
          created_at?: string
          device_info?: Json | null
          extracted_access_key?: string | null
          extracted_cnpj?: string | null
          extracted_date?: string | null
          extracted_value?: number | null
          file_name?: string | null
          file_type?: string | null
          file_url: string
          id?: string
          ocr_data?: Json | null
          ocr_status?: Database["public"]["Enums"]["receipt_status"]
          transaction_id: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          capture_latitude?: number | null
          capture_longitude?: number | null
          capture_timestamp?: string | null
          created_at?: string
          device_info?: Json | null
          extracted_access_key?: string | null
          extracted_cnpj?: string | null
          extracted_date?: string | null
          extracted_value?: number | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string
          id?: string
          ocr_data?: Json | null
          ocr_status?: Database["public"]["Enums"]["receipt_status"]
          transaction_id?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          bank_account_id: string | null
          beneficiary_document: string | null
          beneficiary_name: string | null
          boleto_code: string | null
          category_id: string | null
          classified_at: string | null
          classified_by: string | null
          company_id: string
          created_at: string
          created_by: string
          description: string | null
          external_id: string | null
          id: string
          paid_at: string | null
          pix_copia_cola: string | null
          pix_copy_paste: string | null
          pix_e2eid: string | null
          pix_expiration: string | null
          pix_key: string | null
          pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          pix_location: string | null
          pix_provider_response: Json | null
          pix_qrcode: string | null
          pix_txid: string | null
          pix_type: Database["public"]["Enums"]["pix_type"]
          status: Database["public"]["Enums"]["transaction_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          beneficiary_document?: string | null
          beneficiary_name?: string | null
          boleto_code?: string | null
          category_id?: string | null
          classified_at?: string | null
          classified_by?: string | null
          company_id: string
          created_at?: string
          created_by: string
          description?: string | null
          external_id?: string | null
          id?: string
          paid_at?: string | null
          pix_copia_cola?: string | null
          pix_copy_paste?: string | null
          pix_e2eid?: string | null
          pix_expiration?: string | null
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          pix_location?: string | null
          pix_provider_response?: Json | null
          pix_qrcode?: string | null
          pix_txid?: string | null
          pix_type: Database["public"]["Enums"]["pix_type"]
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          beneficiary_document?: string | null
          beneficiary_name?: string | null
          boleto_code?: string | null
          category_id?: string | null
          classified_at?: string | null
          classified_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          external_id?: string | null
          id?: string
          paid_at?: string | null
          pix_copia_cola?: string | null
          pix_copy_paste?: string | null
          pix_e2eid?: string | null
          pix_expiration?: string | null
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          pix_location?: string | null
          pix_provider_response?: Json | null
          pix_qrcode?: string | null
          pix_txid?: string | null
          pix_type?: Database["public"]["Enums"]["pix_type"]
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feature_permissions: {
        Row: {
          company_id: string
          created_at: string
          feature_key: string
          id: string
          is_visible: boolean
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          feature_key: string
          id?: string
          is_visible?: boolean
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          feature_key?: string
          id?: string
          is_visible?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feature_permissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_page_permissions: {
        Row: {
          company_id: string
          created_at: string
          has_access: boolean
          id: string
          page_key: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          has_access?: boolean
          id?: string
          page_key: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          has_access?: boolean
          id?: string
          page_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_page_permissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      pix_configs_safe: {
        Row: {
          base_url: string | null
          company_id: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          is_sandbox: boolean | null
          pix_key: string | null
          pix_key_type: Database["public"]["Enums"]["pix_key_type"] | null
          provider: string | null
          provider_company_id: string | null
          purpose: Database["public"]["Enums"]["pix_config_purpose"] | null
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          base_url?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_sandbox?: boolean | null
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          provider?: string | null
          provider_company_id?: string | null
          purpose?: Database["public"]["Enums"]["pix_config_purpose"] | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          base_url?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_sandbox?: boolean | null
          pix_key?: string | null
          pix_key_type?: Database["public"]["Enums"]["pix_key_type"] | null
          provider?: string | null
          provider_company_id?: string | null
          purpose?: Database["public"]["Enums"]["pix_config_purpose"] | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pix_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_user_companies: { Args: { _user_id: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operator"
      classification_type: "cost" | "expense"
      pix_config_purpose: "cash_in" | "cash_out" | "both"
      pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "random"
      pix_type: "key" | "copy_paste" | "qrcode" | "boleto" | "cash"
      receipt_status: "pending" | "processing" | "completed" | "failed"
      transaction_status: "pending" | "completed" | "failed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator"],
      classification_type: ["cost", "expense"],
      pix_config_purpose: ["cash_in", "cash_out", "both"],
      pix_key_type: ["cpf", "cnpj", "email", "phone", "random"],
      pix_type: ["key", "copy_paste", "qrcode", "boleto", "cash"],
      receipt_status: ["pending", "processing", "completed", "failed"],
      transaction_status: ["pending", "completed", "failed", "cancelled"],
    },
  },
} as const
