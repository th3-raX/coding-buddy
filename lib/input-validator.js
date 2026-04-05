/**
 * Input validation: prompt injection detection + code confidence scoring.
 */

const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'jsx',
  'python',
  'css',
  'html',
  'sql',
];

const MAX_LINES = 200;
const MAX_CHARS = 15000;
const CODE_CONFIDENCE_THRESHOLD = 15;

// ── Prompt injection patterns ────────────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(your|all|previous)\s+(instructions|rules|prompt)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(a|an|if)\s+/i,
  /pretend\s+(you|to\s+be)\s+/i,
  /your\s+new\s+(role|task|purpose|instructions)/i,
  /show\s+(me\s+)?(your\s+)?(system\s+)?prompt/i,
  /reveal\s+(your\s+)?instructions/i,
  /what\s+are\s+your\s+(rules|instructions)/i,
  /instead\s+of\s+reviewing/i,
  /do\s+not\s+review/i,
  /don'?t\s+review/i,
  /write\s+me\s+(a|an)\s+/i,
  /generate\s+(a|an|the|code|text|story|poem|essay)/i,
  /translate\s+(this|the|following)\s+/i,
  /override\s+(your|the|previous)\s+/i,
  /new\s+instructions?\s*:/i,
  /disregard\s+(all|previous|the|above)/i,
  /\bsystem\s*:\s*/i,
  /\bassistant\s*:\s*/i,
];

// ── Code indicator patterns ──────────────────────────────────────────────────
const CODE_INDICATORS = {
  brackets: /[{}\[\]()]/g,
  operators: /===|!==|==|!=|<=|>=|=>|->|\+=|-=|\*=|\/=|&&|\|\||[+\-*/%<>]/g,
  semicolons: /;$/gm,
  keywords:
    /\b(function|const|let|var|return|if|else|for|while|do|switch|case|break|continue|class|import|export|from|default|async|await|try|catch|finally|throw|new|this|typeof|instanceof|void|delete|in|of|yield|def|print|elif|except|raise|with|as|lambda|pass|True|False|None|self|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|CREATE|ALTER|DROP|JOIN|ORDER|GROUP|HAVING|UNION|INTO|VALUES|SET|AND|OR|NOT|NULL|LIKE|BETWEEN|EXISTS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|int|float|string|boolean|number|type|interface|extends|implements|enum|struct|fn|pub|mod|use|match|impl|trait|readonly|abstract|static|private|public|protected|override|final|super)\b/gi,
  comments: /\/\/.*|\/\*[\s\S]*?\*\/|#[^\n]*|<!--[\s\S]*?-->/g,
  arrows: /(=>|->)/g,
  htmlTags: /<\/?[a-zA-Z][a-zA-Z0-9]*[\s>/]/g,
  cssBlocks: /[.#@]?[a-zA-Z][\w-]*\s*\{/g,
  assignments: /\b\w+\s*[:=]\s*/g,
  functionCalls: /\b\w+\s*\(/g,
};

/**
 * Detect prompt injection attempts in the input text.
 * @param {string} text
 * @returns {{ safe: boolean, reason?: string }}
 */
function detectInjection(text) {
  // Check each line outside of string literals and comments for injection patterns.
  // We check the raw text to be thorough — injection can appear in comments too.
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason:
          'Your input contains patterns that don\'t look like code. Please paste a valid code snippet.',
      };
    }
  }
  return { safe: true };
}

/**
 * Compute a confidence score (0–100) that the input is actual code.
 * @param {string} code
 * @returns {number}
 */
function computeCodeConfidence(code) {
  const lines = code.split('\n');
  const lineCount = lines.length || 1;
  let score = 0;

  const count = (pattern) => (code.match(pattern) || []).length;

  const brackets = count(CODE_INDICATORS.brackets);
  const operators = count(CODE_INDICATORS.operators);
  const semicolons = count(CODE_INDICATORS.semicolons);
  const keywords = count(CODE_INDICATORS.keywords);
  const comments = count(CODE_INDICATORS.comments);
  const arrows = count(CODE_INDICATORS.arrows);
  const htmlTags = count(CODE_INDICATORS.htmlTags);
  const cssBlocks = count(CODE_INDICATORS.cssBlocks);
  const assignments = count(CODE_INDICATORS.assignments);
  const functionCalls = count(CODE_INDICATORS.functionCalls);

  // Score each indicator (normalized by line count, capped)
  score += Math.min((brackets / lineCount) * 12, 20);
  score += Math.min((operators / lineCount) * 8, 15);
  score += Math.min((semicolons / lineCount) * 10, 12);
  score += Math.min((keywords / lineCount) * 10, 25);
  score += Math.min(comments * 3, 8);
  score += Math.min(arrows * 5, 8);
  score += Math.min((htmlTags / lineCount) * 10, 18);
  score += Math.min((cssBlocks / lineCount) * 10, 18);
  score += Math.min((assignments / lineCount) * 6, 12);
  score += Math.min((functionCalls / lineCount) * 6, 12);

  // Bonus: indentation patterns (very common in code)
  const indentedLines = lines.filter((l) => /^\s{2,}/.test(l)).length;
  score += Math.min((indentedLines / lineCount) * 15, 12);

  return Math.min(Math.round(score), 100);
}

/**
 * Validate the user's input before sending to the AI.
 * @param {string} code
 * @param {string} language
 * @returns {{ valid: boolean, error?: string, confidence?: number }}
 */
function validateInput(code, language) {
  // Check language
  if (!language || !SUPPORTED_LANGUAGES.includes(language.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported language. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    };
  }

  // Check empty
  if (!code || !code.trim()) {
    return { valid: false, error: 'Code snippet cannot be empty.' };
  }

  // Check line count
  const lines = code.split('\n');
  if (lines.length > MAX_LINES) {
    return {
      valid: false,
      error: `Code exceeds the ${MAX_LINES}-line limit (${lines.length} lines). Please shorten your snippet.`,
    };
  }

  // Check character count
  if (code.length > MAX_CHARS) {
    return {
      valid: false,
      error: `Code exceeds the ${MAX_CHARS.toLocaleString()}-character limit. Please shorten your snippet.`,
    };
  }

  // Prompt injection check
  const injection = detectInjection(code);
  if (!injection.safe) {
    return { valid: false, error: injection.reason };
  }

  // Code confidence check
  const confidence = computeCodeConfidence(code);
  if (confidence < CODE_CONFIDENCE_THRESHOLD) {
    return {
      valid: false,
      error:
        "This doesn't appear to be code. Please paste a valid code snippet to review.",
    };
  }

  return { valid: true, confidence };
}

module.exports = { validateInput, detectInjection, computeCodeConfidence };
