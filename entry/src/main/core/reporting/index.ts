export { ReportBuilder, SectionType, type Section, type FigureReference, type TableReference, type StatisticalResult, type Author } from './ReportBuilder';
export { LatexCompiler, type CompileOptions, type CompileResult, compileLaTeX, exportTeXFile, compilePDF, createScientificReport, createPhylogeneticReport, escapeLatex } from './LatexCompiler';
export { TableGenerator, type TableStyle } from './TableGenerator';
export { MatrixConverter, type MatrixFormat } from './MatrixConverter';
export { FigureHandler, type Figure } from './FigureHandler';
export { LATEX_PREAMBLE } from './latexPreamble';
