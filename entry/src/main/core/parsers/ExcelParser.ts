/**
 * Excel parser ¡ª replaces pandas.read_excel
 * HarmonyOS: uses @ohos.system.filepicker + JSZip for .xlsx
 */
export interface ExcelData {
  sheets: { name: string; data: number[][]; rowLabels: string[]; colLabels: string[] }[];
  nSheets: number;
}

export function parseExcelText(text: string, delimiter: string = "	"): ExcelData {
  // For .xls or tab-delimited exports
  const lines = text.trim().split(/?
/);
  if (lines.length === 0) return { sheets: [], nSheets: 0 };
  
  const colLabels = lines[0].split(delimiter).map(s => s.trim());
  const rowLabels: string[] = [];
  const data: number[][] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter);
    rowLabels.push(parts[0]?.trim() || "Row_" + i);
    const row = parts.slice(1).map(v => {
      const n = parseFloat(v);
      return isNaN(n) ? NaN : n;
    });
    data.push(row);
  }
  
  return { sheets: [{ name: "Sheet1", data, rowLabels, colLabels }], nSheets: 1 };
}
