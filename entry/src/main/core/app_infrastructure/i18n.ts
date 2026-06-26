const translations: Record<string, Record<string, string>> = {
  en: {
    'No data loaded': 'No data loaded',
    'Analysis complete': 'Analysis complete',
    'Error': 'Error',
    'Warning': 'Warning',
    'PCA': 'Principal Component Analysis',
    'PCoA': 'Principal Coordinate Analysis',
    'NMDS': 'Non-metric MDS',
  },
  zh: {
    'No data loaded': '未加载数据',
    'Analysis complete': '分析完成',
    'Error': '错误',
    'Warning': '警告',
    'PCA': '主成分分析',
    'PCoA': '主坐标分析',
    'NMDS': '非度量多维尺度分析',
  },
};

let currentLang = 'en';

export function setLanguage(lang: string): void { currentLang = lang; }
export function getLanguage(): string { return currentLang; }

export function t(key: string, ...args: unknown[]): string {
  const dict = translations[currentLang] ?? translations['en'];
  let text = dict[key] ?? key;
  for (let i = 0; i < args.length; i++) text = text.replace('{' + i + '}', String(args[i]));
  return text;
}
