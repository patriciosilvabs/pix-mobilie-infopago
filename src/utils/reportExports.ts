import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { extractStoragePath, getSignedReceiptUrl } from "@/utils/storageHelpers";

interface TransactionRow {
  date: string;
  description: string;
  amount: number;
  category: string;
  classification: string;
  status: string;
  receiptUrl: string;
}

async function mapTransactions(transactions: any[]): Promise<TransactionRow[]> {
  const rows: TransactionRow[] = [];
  for (const t of transactions) {
    const rawUrl = t.receipts?.[0]?.file_url || "";
    const receiptUrl = rawUrl ? await getSignedReceiptUrl(rawUrl) : "";
    rows.push({
      date: format(new Date(t.created_at), "dd/MM/yyyy"),
      description: t.description || t.beneficiary_name || "",
      amount: Number(t.amount),
      category: t.categories?.name || "",
      classification:
        t.categories?.classification === "cost"
          ? "Custo"
          : t.categories?.classification === "expense"
          ? "Despesa"
          : "",
      status:
        t.status === "completed"
          ? "Concluído"
          : t.status === "failed"
          ? "Falhou"
          : t.status === "cancelled"
          ? "Cancelado"
          : "Pendente",
      receiptUrl,
    });
  }
  return rows;
}

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

// ─── CSV ───────────────────────────────────────────────
export async function exportCSV(transactions: any[]) {
  const rows = await mapTransactions(transactions);
  const header = "Data,Descrição,Valor,Categoria,Classificação,Status,Comprovante\n";
  const body = rows
    .map((r) =>
      [r.date, `"${r.description}"`, r.amount.toFixed(2), r.category, r.classification, r.status, r.receiptUrl].join(",")
    )
    .join("\n");
  download(header + body, `relatorio-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv");
}

// ─── XLSX ──────────────────────────────────────────────
export async function exportXLSX(transactions: any[]) {
  const rows = await mapTransactions(transactions);
  const data = rows.map((r) => ({
    Data: r.date,
    Descrição: r.description,
    Valor: r.amount,
    Categoria: r.category,
    Classificação: r.classification,
    Status: r.status,
    Comprovante: r.receiptUrl,
  }));
  const ws = XLSX.utils.json_to_sheet(data);

  // Set column widths
  ws["!cols"] = [
    { wch: 12 },
    { wch: 30 },
    { wch: 14 },
    { wch: 20 },
    { wch: 14 },
    { wch: 12 },
    { wch: 60 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, `relatorio-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}

// ─── PDF ───────────────────────────────────────────────
export async function exportPDF(
  transactions: any[],
  summary: { totalAmount: number; totalCosts: number; totalExpenses: number },
  companyName: string,
  periodLabel: string
) {
  const rows = await mapTransactions(transactions);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(16);
  doc.text(companyName, 14, 20);
  doc.setFontSize(10);
  doc.text(`Relatório Financeiro — ${periodLabel}`, 14, 27);
  doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 33);

  // Summary
  doc.setFontSize(11);
  doc.text(`Total Saídas: R$ ${fmt(summary.totalAmount)}`, 14, 43);
  doc.text(`Custos: R$ ${fmt(summary.totalCosts)}`, 14, 49);
  doc.text(`Despesas: R$ ${fmt(summary.totalExpenses)}`, 14, 55);

  // Table
  autoTable(doc, {
    startY: 62,
    head: [["Data", "Favorecido", "Valor", "Categoria", "Class.", "Status"]],
    body: rows.map((r) => [
      r.date,
      r.description,
      `R$ ${fmt(r.amount)}`,
      r.category,
      r.classification,
      r.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [100, 45, 180] },
  });

  // Receipt pages — fetch images and embed with proper sizing
  const MAX_WIDTH = 180; // mm (14mm margin each side)
  const MAX_HEIGHT = 250; // mm (leave space for label at top)

  for (const t of transactions) {
    const rawUrl = t.receipts?.[0]?.file_url;
    if (!rawUrl) continue;
    const ext = rawUrl.split(".").pop()?.toLowerCase() || "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) continue;

    try {
      const signedUrl = await getSignedReceiptUrl(rawUrl);
      if (!signedUrl) continue;

      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const base64 = await blobToBase64(blob);
      const imgFormat = ext === "png" ? "PNG" : "JPEG";

      // Get image dimensions for proper aspect ratio scaling
      const dims = await getImageDimensions(base64);
      let imgW = MAX_WIDTH;
      let imgH = (dims.height / dims.width) * MAX_WIDTH;

      // If too tall, constrain by height instead
      if (imgH > MAX_HEIGHT) {
        imgH = MAX_HEIGHT;
        imgW = (dims.width / dims.height) * MAX_HEIGHT;
      }

      doc.addPage();
      doc.setFontSize(11);
      const label = `${format(new Date(t.created_at), "dd/MM/yyyy")} — ${t.beneficiary_name || t.description || "Sem descrição"} — R$ ${fmt(Number(t.amount))}`;
      doc.text(label, 14, 15);
      doc.addImage(base64, imgFormat, 14, 22, imgW, imgH);
    } catch {
      // skip if image fails to load
    }
  }

  doc.save(`relatorio-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}

function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 1, height: 1 }); // fallback
    img.src = base64;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
