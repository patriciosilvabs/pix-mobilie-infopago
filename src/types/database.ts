// Database types for the application

export type AppRole = "admin" | "operator";

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

export type PixType = "key" | "copy_paste" | "qrcode" | "boleto";

export type TransactionStatus = "pending" | "completed" | "cancelled" | "failed";

export type ReceiptStatus = "pending" | "processing" | "completed" | "error";

export type Classification = "cost" | "expense";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  name: string;
  cnpj?: string;
  logo_url?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  payment_limit?: number;
  can_view_balance: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  company_id: string;
  name: string;
  classification: Classification;
  parent_id?: string;
  keywords?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  bank_name: string;
  agency?: string;
  account_number?: string;
  pix_key?: string;
  pix_key_type?: PixKeyType;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  company_id: string;
  bank_account_id?: string;
  category_id?: string;
  created_by: string;
  classified_by?: string;
  amount: number;
  status: TransactionStatus;
  pix_type: PixType;
  pix_key?: string;
  pix_key_type?: PixKeyType;
  pix_copy_paste?: string;
  beneficiary_name?: string;
  beneficiary_document?: string;
  description?: string;
  external_id?: string;
  paid_at?: string;
  classified_at?: string;
  created_at: string;
  updated_at: string;
  // New Pix integration fields
  pix_txid?: string;
  pix_e2eid?: string;
  pix_location?: string;
  pix_qrcode?: string;
  pix_copia_cola?: string;
  pix_expiration?: string;
  pix_provider_response?: Record<string, unknown>;
}

export interface Receipt {
  id: string;
  transaction_id: string;
  uploaded_by: string;
  file_url: string;
  file_name?: string;
  file_type?: string;
  ocr_status: ReceiptStatus;
  ocr_data?: Record<string, unknown>;
  extracted_value?: number;
  extracted_date?: string;
  extracted_cnpj?: string;
  extracted_access_key?: string;
  capture_timestamp?: string;
  capture_latitude?: number;
  capture_longitude?: number;
  device_info?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  company_id?: string;
  entity_type: string;
  entity_id?: string;
  action: string;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

// New Pix integration types
export type PixConfigPurpose = "cash_in" | "cash_out" | "both";

export interface PixConfig {
  id: string;
  company_id: string;
  provider: string;
  client_id: string;
  client_secret_encrypted: string;
  base_url: string;
  pix_key: string;
  pix_key_type: PixKeyType;
  certificate_encrypted?: string;
  certificate_key_encrypted?: string;
  webhook_url?: string;
  webhook_secret?: string;
  purpose: PixConfigPurpose;
  is_sandbox: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PixToken {
  id: string;
  company_id: string;
  pix_config_id?: string;
  access_token: string;
  token_type: string;
  expires_at: string;
  created_at: string;
}

export interface PixRefund {
  id: string;
  transaction_id: string;
  e2eid: string;
  refund_id: string;
  valor: number;
  motivo?: string;
  status: "EM_PROCESSAMENTO" | "DEVOLVIDO" | "NAO_REALIZADO";
  refunded_at?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  created_by?: string;
}

export interface PixWebhookLog {
  id: string;
  company_id?: string;
  event_type: string;
  payload: Record<string, unknown>;
  ip_address?: string;
  processed: boolean;
  error_message?: string;
  created_at: string;
}
