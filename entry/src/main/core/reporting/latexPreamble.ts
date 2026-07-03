/**
 * Standard LaTeX preamble for PaleoAST scientific reports.
 * Replace reporting/latex_preamble.py.
 */
export const LATEX_PREAMBLE = String.raw`\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{multirow}
\usepackage{longtable}
\usepackage{array}
\usepackage{caption}
\usepackage{subcaption}
\usepackage{float}
\usepackage{geometry}
\geometry{a4paper, margin=2.5cm}
\usepackage{xcolor}
\definecolor{paleoGreen}{RGB}{34,139,34}
\definecolor{paleoRed}{RGB}{178,34,34}
\definecolor{paleoBlue}{RGB}{31,119,180}
\usepackage{hyperref}
\hypersetup{colorlinks=true,linkcolor=paleoBlue,citecolor=paleoBlue,urlcolor=paleoBlue}
\usepackage{natbib}
\usepackage{setspace}
\onehalfspacing
\usepackage{microtype}
\usepackage{tikz}
\usetikzlibrary{positioning,shapes,arrows}
`;
