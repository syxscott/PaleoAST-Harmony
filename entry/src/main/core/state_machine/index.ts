export { State, Transition, StateMachine } from './Base';
export { FiniteAutomaton, DFA, NFA, RegexCompiler } from './Automaton';
export { LexerTokenizer, TokenType } from './Tokenizer';
// Token and LexerRule are types: re-exporting them as values breaks module
// instantiation outside the hvigor/TS pipeline.
export type { Token, LexerRule } from './Tokenizer';
