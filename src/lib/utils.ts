import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency in BRL
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

// Format currency without symbol
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Format date in Brazilian format
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// Format date and time
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Format relative time
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Agora";
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return formatDate(d);
}

// Mask CPF
export function maskCPF(cpf: string): string {
  const clean = cpf.replace(/\D/g, "");
  return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

// Mask CNPJ
export function maskCNPJ(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "");
  return clean.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5"
  );
}

// Mask phone
export function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 11) {
    return clean.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  return clean.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
}

// Validate CPF
export function isValidCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11 || /^(\d)\1+$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i)) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  if (digit !== parseInt(clean.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i)) * (11 - i);
  }
  digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  return digit === parseInt(clean.charAt(10));
}

// Validate CNPJ
export function isValidCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14 || /^(\d)\1+$/.test(clean)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(clean.charAt(i)) * weights1[i];
  }
  let digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  if (digit !== parseInt(clean.charAt(12))) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(clean.charAt(i)) * weights2[i];
  }
  digit = 11 - (sum % 11);
  if (digit > 9) digit = 0;
  return digit === parseInt(clean.charAt(13));
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Truncate text
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + "...";
}

// Generate random ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Parse localized number (handles BR format: 1.234,56 and US format: 1,234.56)
// Returns NaN for invalid/empty inputs instead of 0
export function parseLocalizedNumber(value: string, useCommaDecimal?: boolean): number {
  if (!value || value.trim() === "") return NaN;

  let str = String(value).trim();

  // Remove currency symbols and spaces
  str = str.replace(/[R$\u20AC£¥\s]/g, "");

  // Reject if empty after cleanup or has invalid chars
  if (!str || !/^[\d.,\-]+$/.test(str)) return NaN;

  const dots = (str.match(/\./g) || []).length;
  const commas = (str.match(/,/g) || []).length;
  const lastComma = str.lastIndexOf(",");
  const lastDot = str.lastIndexOf(".");

  let isCommaDecimal: boolean;

  if (useCommaDecimal !== undefined) {
    isCommaDecimal = useCommaDecimal;
  } else if (commas === 1 && dots === 0) {
    // "79,90" → BR decimal
    isCommaDecimal = true;
  } else if (dots === 1 && commas === 0) {
    // "79.90" → US decimal
    isCommaDecimal = false;
  } else if (commas >= 1 && dots >= 1) {
    // Mixed: whoever is last is the decimal separator
    isCommaDecimal = lastComma > lastDot;
  } else if (dots > 1 && commas === 0) {
    // "1.234.567" → dots are thousands (BR integer)
    isCommaDecimal = true; // treat dots as thousands
  } else if (commas > 1 && dots === 0) {
    // "1,234,567" → commas are thousands (US integer)
    isCommaDecimal = false;
  } else {
    // Fallback: no separators, plain number
    isCommaDecimal = false;
  }

  if (isCommaDecimal) {
    // Validate thousand separator pattern: dots must group 3 digits
    if (dots > 0) {
      const parts = str.split(",")[0].split(".");
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length !== 3) return NaN; // malformed thousands
      }
    }
    str = str.replace(/\./g, "");
    str = str.replace(",", ".");
  } else {
    if (commas > 0) {
      const parts = str.split(".")[0].split(",");
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].length !== 3) return NaN;
      }
    }
    str = str.replace(/,/g, "");
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? NaN : parsed;
}

// Max allowed payment value (R$ 1.000.000,00)
export const MAX_PAYMENT_VALUE = 1_000_000;

// Validate payment amount is within acceptable range
// Optionally pass expectedValue to cross-check against QR/boleto extracted value
export function isValidPaymentAmount(
  value: number,
  options?: { expectedValue?: number; tolerancePercent?: number }
): { valid: boolean; message?: string } {
  if (isNaN(value) || value <= 0) return { valid: false, message: "Informe um valor válido" };
  if (value < 0.01) return { valid: false, message: "O valor mínimo é R$ 0,01" };
  if (value > MAX_PAYMENT_VALUE) return { valid: false, message: `O valor máximo permitido é R$ ${MAX_PAYMENT_VALUE.toLocaleString("pt-BR")}` };

  // Cross-check against expected value if provided
  if (options?.expectedValue && options.expectedValue > 0) {
    const tolerance = options.tolerancePercent ?? 1; // default 1%
    const diff = Math.abs(value - options.expectedValue) / options.expectedValue * 100;
    if (diff > tolerance) {
      return {
        valid: false,
        message: `O valor R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} diverge do esperado R$ ${options.expectedValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      };
    }
  }

  return { valid: true };
}

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
