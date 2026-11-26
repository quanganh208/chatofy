#!/usr/bin/env node
/**
 * path-extractor.cjs - Extract paths from Claude Code tool inputs
 *
 * Extracts file_path, path, pattern params and parses Bash commands
 * to find all path-like arguments.
 */

// Flags that indicate the following value should NOT be checked as a path
// These are "exclude" semantics - the user is explicitly skipping these paths
const EXCLUDE_FLAGS = [
  '--exclude', '--ignore', '--skip', '--prune',
  '-x',           // tar exclude shorthand
  '-path',        // find -path (used with -prune)
  '--exclude-dir' // grep --exclude-dir
];

// Filesystem commands where bare directory names (build, dist, etc.)
// should be extracted as paths. For non-fs commands (grep, echo, sed),
// only tokens that look like actual paths (contain / or extension) are extracted.
const FILESYSTEM_COMMANDS = [
  'cd', 'ls', 'cat', 'head', 'tail', 'less', 'more',
  'rm', 'cp', 'mv', 'find', 'touch', 'mkdir', 'rmdir',
  'stat', 'file', 'du', 'tree', 'chmod', 'chown', 'ln',
  'readlink', 'realpath', 'wc', 'tee', 'tar', 'zip', 'unzip',
  'open', 'code', 'vim', 'nano', 'bat', 'rsync', 'scp', 'diff'
];

// Commands whose quoted arguments are search patterns / regexes / filter
// expressions, NOT filesystem paths. A quoted arg to one of these (e.g.
// `grep -v "node_modules\|.claude"`) must never be treated as an accessed path.
const PATTERN_ARG_COMMANDS = [
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  'sed', 'awk', 'gawk', 'jq', 'perl'
];

// Flags whose following value is a search pattern / regex / glob rather than an
// accessed path (covers `git grep -e "..."`, `git log --grep "..."`,
// `grep --include="*.js"`, etc.). Matched against the token immediately before
// a quoted string, with any trailing `=` stripped.
const PATTERN_ARG_FLAGS = [
  '-e', '-E', '-P', '-G', '-S', '--regexp', '--grep', '--include'
];

// Command wrappers to skip when resolving the governing command of a segment.
const COMMAND_WRAPPERS = ['sudo', 'env', 'nice', 'nohup', 'time', 'timeout'];

// The PowerShell dialect name scout-checker passes in (kept as a literal here:
// scout-checker requires this module, so requiring it back would be a cycle).
const POWERSHELL_DIALECT = 'powershell';

// PowerShell filesystem cmdlets and their built-in aliases, compared
// lower-cased because PowerShell resolves command names case-insensitively.
// The POSIX-named aliases PowerShell also ships (cd, ls, cat, rm, cp, mv, ...)
// are already in FILESYSTEM_COMMANDS.
const POWERSHELL_FILESYSTEM_COMMANDS = [
  'get-content', 'gc', 'type',
  'get-childitem', 'gci', 'dir',
  'set-location', 'sl', 'chdir', 'push-location', 'pushd',
  'get-item', 'gi', 'get-itemproperty', 'gp', 'test-path', 'resolve-path', 'rvpa',
  'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move',
  'remove-item', 'ri', 'del', 'erase', 'rd', 'new-item', 'ni',
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object',
  'import-csv', 'ipcsv', 'get-filehash', 'invoke-item', 'ii', 'expand-archive', 'compress-archive'
];

// PowerShell's grep: its quoted -Pattern argument is a regex, not a path.
const POWERSHELL_PATTERN_ARG_COMMANDS = ['select-string', 'sls'];
const POWERSHELL_PATTERN_ARG_FLAGS = ['-pattern'];

// `-Path:value` binds a PowerShell parameter to its value in one token.
// PowerShell also accepts an en, em, or horizontal-bar dash as the dash.
const POWERSHELL_COLON_PARAMETER = /^([-–-―][A-Za-z][\w-]*):(.+)$/;

// PowerShell parameters whose value is the path a cmdlet reads, compared
// lower-cased. In PowerShell `-path` is one of these in any case, never the
// `find -path` exclusion that EXCLUDE_FLAGS lists for POSIX commands.
const POWERSHELL_PATH_PARAMETERS = ['-path', '-literalpath', '-lp', '-pspath'];

/**
 * Lower-case a PowerShell parameter name and give it an ASCII dash.
 * @param {string} token
 * @returns {string}
 */
function powerShellParameterName(token) {
  return token.replace(/^[–-―]/, '-').replace(/:$/, '').toLowerCase();
}

/**
 * Whether `token` is a flag whose following value is excluded from access.
 * @param {string} token
 * @param {boolean} powershell
 * @returns {boolean}
 */
function isExcludeFlag(token, powershell) {
  if (powershell && POWERSHELL_PATH_PARAMETERS.includes(powerShellParameterName(token))) return false;
  return EXCLUDE_FLAGS.includes(token);
}

/**
 * Whether `token` is a PowerShell parameter that names the path to read.
 * @param {string} token
 * @param {boolean} powershell
 * @returns {boolean}
 */
function isPowerShellPathParameter(token, powershell) {
  return powershell && POWERSHELL_PATH_PARAMETERS.includes(powerShellParameterName(token));
}

/**
 * Extract all paths from a tool_input object
 * Handles: file_path, path, pattern params and command strings
 *
 * @param {Object} toolInput - The tool_input from hook JSON
 * @param {Object} [options]
 * @param {string} [options.dialect] - Shell syntax of `command`: 'posix' (default) or 'powershell'
 * @returns {string[]} Array of extracted paths
 */
function extractFromToolInput(toolInput, options = {}) {
  const paths = [];

  if (!toolInput || typeof toolInput !== 'object') {
    return paths;
  }

  // Direct path params (Read, Edit, Write, Grep, Glob tools)
  const directParams = ['file_path', 'path', 'pattern'];
  for (const param of directParams) {
    if (toolInput[param] && typeof toolInput[param] === 'string') {
      const normalized = normalizeExtractedPath(toolInput[param]);
      if (normalized) paths.push(normalized);
    }
  }

  // Extract from a shell command if present
  if (toolInput.command && typeof toolInput.command === 'string') {
    const cmdPaths = extractFromCommand(toolInput.command, options);
    paths.push(...cmdPaths);
  }

  return paths.filter(Boolean);
}

// Flags whose value is free text (a commit message, a PR body, a report),
// never an accessed path, quoted or not: `git commit -m "fix the build step"`,
// `gh pr create --body "..."`, `ak feedback --repro "..."`. Also matched in
// the `--flag=value` form.
const TEXT_ARG_FLAGS = [
  '-m', '--message', '--body', '--title', '--subject', '--notes',
  '--description', '--comment', '--repro', '--eval'
];

// Commands whose quoted arguments are text to print, not files they open.
const TEXT_ARG_COMMANDS = ['echo', 'printf'];

// Commands whose TEXT_ARG_FLAGS take free text. Elsewhere the same spelling
// can be an ordinary switch (`ls -m`, `tar -m`) followed by a real path.
const TEXT_FLAG_COMMANDS = ['git', 'gh', 'glab', 'ak', 'hg', 'svn', 'jj', 'node', 'deno', 'bun'];

// Nesting cap for command substitutions checked as commands of their own.
const MAX_SUBSTITUTION_DEPTH = 32;

// Unquoted characters that end a word and start an operator.
const OPERATOR_CHARS = '&|;()<>';

/**
 * Read a `$( ... )` body starting just after the `(`, honouring nested
 * parentheses and quotes.
 * @param {string} source
 * @param {number} start
 * @returns {{ inner: string, end: number }} end is the index after `)`
 */
function readParenBody(source, start) {
  let depth = 1;
  let pendingHeredocs = [];
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '\n' && pendingHeredocs.length) {
      // A heredoc body is text: an apostrophe in it opens no quote.
      i = skipHeredocBodies(source, i + 1, pendingHeredocs) - 1;
      pendingHeredocs = [];
    } else if (char === '<' && source[i + 1] === '<' && source[i + 2] !== '<') {
      const dash = source[i + 2] === '-';
      const heredoc = readHeredocDelimiter(source, i + (dash ? 3 : 2), dash);
      if (heredoc.word) pendingHeredocs.push(heredoc);
      i = heredoc.end - 1;
    } else if (char === "'") {
      // An unmatched quote is kept literal rather than swallowing the rest.
      const close = source.indexOf("'", i + 1);
      if (close !== -1) i = close;
    } else if (char === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' || source[i] === '`') i++;
        i++;
      }
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return { inner: source.slice(start, i), end: i + 1 };
    }
  }
  return { inner: source.slice(start), end: source.length };
}

/**
 * Read the delimiter word of a heredoc, starting just after `<<` or `<<-`.
 * Single quotes, double quotes and backslashes are removed from the word,
 * and any of them marks the delimiter as quoted (`<<'E'`, `<<"E"`, `<<\\E`,
 * `<<E"X"`). ANSI-C `$'E'` and locale `$"E"` quoting are not handled.
 * @param {string} source
 * @param {number} start
 * @param {boolean} dash - `<<-`: leading tabs are stripped from body lines
 * @returns {{ word: string, quoted: boolean, dash: boolean, end: number }}
 */
function readHeredocDelimiter(source, start, dash) {
  let i = start;
  while (source[i] === ' ' || source[i] === '\t') i++;
  let word = '';
  let quoted = false;
  // Like the shell, only a space, tab or newline ends the word (a carriage
  // return is part of it), and quoted blanks or operators stay in it.
  while (i < source.length && !' \t\n'.includes(source[i]) && !OPERATOR_CHARS.includes(source[i])) {
    const char = source[i];
    if (char === "'") {
      quoted = true;
      const close = source.indexOf("'", i + 1);
      const end = close === -1 ? source.length : close;
      word += source.slice(i + 1, end);
      i = end + 1;
    } else if (char === '"') {
      quoted = true;
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && '"\\$`'.includes(source[i + 1] || ' ')) i++;
        word += source[i++];
      }
      i++;
    } else if (char === '\\') {
      quoted = true;
      word += source[i + 1] || '';
      i += 2;
    } else {
      word += char;
      i++;
    }
  }
  return { word, quoted, dash, end: Math.min(i, source.length) };
}

/**
 * Skip heredoc bodies that start at `index` (the character after the
 * newline that ends the heredoc's command line).
 *
 * The shell expands `$(...)` and backticks in the body of a heredoc whose
 * delimiter word is unquoted (`<<E`), so with `substitutions` given, those
 * bodies are collected there as commands of their own. A quoted delimiter
 * (`<<'E'`, `<<"E"`, `<<\E`) keeps the body as plain text.
 * @param {string} source
 * @param {number} index
 * @param {Array<{word: string, quoted: boolean, dash: boolean}>} delimiters - In the order the heredocs were opened
 * @param {string[]} [substitutions] - Receives the substitutions of unquoted bodies
 * @returns {number} Index of the first character after the last body
 */
function skipHeredocBodies(source, index, delimiters, substitutions) {
  let i = index;
  for (const delimiter of delimiters) {
    const bodyStart = i;
    let bodyEnd = source.length;
    while (i < source.length) {
      const newline = source.indexOf('\n', i);
      const lineEnd = newline === -1 ? source.length : newline;
      const line = source.slice(i, lineEnd);
      const lineStart = i;
      i = newline === -1 ? source.length : newline + 1;
      // Like the shell, only an exact line ends the body: `<<-` strips leading
      // tabs, nothing strips spaces or a carriage return.
      if ((delimiter.dash ? line.replace(/^\t+/, '') : line) === delimiter.word) {
        bodyEnd = lineStart;
        break;
      }
    }
    if (substitutions && !delimiter.quoted) {
      collectHeredocSubstitutions(source.slice(bodyStart, bodyEnd), substitutions);
    }
  }
  return i;
}

/**
 * Collect the `$(...)` and backtick substitutions of an unquoted heredoc
 * body. Quotes in the body are literal text, and a backslash escapes `$`,
 * a backtick, or another backslash, as in the shell.
 * @param {string} body
 * @param {string[]} substitutions
 */
function collectHeredocSubstitutions(body, substitutions) {
  let i = 0;
  while (i < body.length) {
    const char = body[i];
    if (char === '\\' && '$`\\'.includes(body[i + 1])) {
      i += 2;
    } else if (char === '$' && body[i + 1] === '(') {
      const inner = readParenBody(body, i + 2);
      substitutions.push(inner.inner);
      i = inner.end;
    } else if (char === '`') {
      const close = body.indexOf('`', i + 1);
      substitutions.push(body.slice(i + 1, close === -1 ? body.length : close));
      i = close === -1 ? body.length : close + 1;
    } else {
      i++;
    }
  }
}

/**
 * Split a command line into shell words and operators the way the shell
 * does: a quote is closed only by the same quote type, a backslash (a
 * backtick in PowerShell) escapes the next character, adjacent quoted and
 * unquoted parts join into one word (`bu""ild` is `build`), and heredoc
 * bodies are dropped.
 *
 * Variables are not expanded: `$DIR` stays the literal text `$DIR`, so a path
 * held only in a variable is not detected, while a literal path around one
 * (`"$HOME/build/x.js"`) still is. Command substitutions (`$(...)` and
 * backticks) are returned separately because the shell runs them as commands
 * of their own; single-quoted text never substitutes.
 *
 * @param {string} command
 * @param {boolean} powershell
 * @returns {{ tokens: Array<{type: string, text: string, quoted?: boolean}>, substitutions: string[] }}
 */
function tokenizeShell(command, powershell) {
  const tokens = [];
  const substitutions = [];
  let word = null;
  let pendingHeredocs = [];
  const flush = () => {
    if (word) tokens.push({ type: 'word', text: word.text, quoted: word.quoted });
    word = null;
  };
  const begin = () => {
    if (!word) word = { text: '', quoted: false };
    return word;
  };

  let i = 0;
  while (i < command.length) {
    const char = command[i];
    const next = command[i + 1];

    if (char === '\n') {
      flush();
      tokens.push({ type: 'op', text: '\n' });
      i++;
      if (pendingHeredocs.length) {
        // PowerShell has no heredocs, and its backtick is an escape character.
        i = skipHeredocBodies(command, i, pendingHeredocs, powershell ? undefined : substitutions);
        pendingHeredocs = [];
      }
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      i++;
      continue;
    }
    if (char === "'") {
      const current = begin();
      current.quoted = true;
      i++;
      while (i < command.length) {
        if (command[i] === "'") {
          // PowerShell writes a literal apostrophe inside '...' as ''.
          if (powershell && command[i + 1] === "'") {
            current.text += "'";
            i += 2;
            continue;
          }
          break;
        }
        current.text += command[i++];
      }
      i++;
      continue;
    }
    if (char === '"') {
      const current = begin();
      current.quoted = true;
      i++;
      while (i < command.length && command[i] !== '"') {
        const inner = command[i];
        const after = command[i + 1];
        if (!powershell && inner === '\\' && after !== undefined && '"\\$`\n'.includes(after)) {
          current.text += after;
          i += 2;
        } else if (powershell && inner === '`' && after !== undefined) {
          current.text += after;
          i += 2;
        } else if (inner === '$' && after === '(') {
          const body = readParenBody(command, i + 2);
          substitutions.push(body.inner);
          i = body.end;
        } else if (!powershell && inner === '`') {
          const close = command.indexOf('`', i + 1);
          substitutions.push(command.slice(i + 1, close === -1 ? command.length : close));
          i = close === -1 ? command.length : close + 1;
        } else {
          current.text += inner;
          i++;
        }
      }
      i++;
      continue;
    }
    if (char === '$' && next === '(') {
      begin();
      const body = readParenBody(command, i + 2);
      substitutions.push(body.inner);
      i = body.end;
      continue;
    }
    if (char === '`') {
      if (powershell) {
        begin().text += next === undefined ? '' : next;
        i += 2;
      } else {
        begin();
        const close = command.indexOf('`', i + 1);
        substitutions.push(command.slice(i + 1, close === -1 ? command.length : close));
        i = close === -1 ? command.length : close + 1;
      }
      continue;
    }
    // A POSIX backslash escapes a shell metacharacter; before an ordinary
    // character it is kept, so Windows-style `dist\app.js` still reads as a path.
    if (!powershell && char === '\\' && next !== undefined && ` \t'"\\$\`${OPERATOR_CHARS}`.includes(next)) {
      begin().text += next;
      i += 2;
      continue;
    }
    // PowerShell parentheses group an expression inside the same command
    // (`Get-Content -Path ("node_modules")`), so they only end a word.
    if (powershell && (char === '(' || char === ')')) {
      flush();
      i++;
      continue;
    }
    if (OPERATOR_CHARS.includes(char)) {
      flush();
      const op = command.slice(i).match(/^(<<<|<<-|<<|>>|>&|<&|&&|\|\||\|&|;;|[&|;()<>])/)[0];
      tokens.push({ type: 'op', text: op });
      i += op.length;
      if (op === '<<' || op === '<<-') {
        const heredoc = readHeredocDelimiter(command, i, op === '<<-');
        if (heredoc.word) pendingHeredocs.push(heredoc);
        i = heredoc.end;
      }
      continue;
    }
    begin().text += char;
    i++;
  }
  flush();
  return { tokens, substitutions };
}

/**
 * Split a `--flag=value` word into its flag and value.
 * @param {string} text
 * @returns {{ flag: string, value: (string|null) }}
 */
function splitFlagValue(text) {
  const eq = text.indexOf('=');
  if (!text.startsWith('-') || eq === -1) return { flag: text, value: null };
  return { flag: text.slice(0, eq), value: text.slice(eq + 1) };
}

/**
 * Extract path-like segments from a Bash command string.
 *
 * The command is split into shell words first (see tokenizeShell), so quotes
 * pair only with their own type and an apostrophe inside a double-quoted path
 * cannot reach into later arguments.
 *
 * Uses pipe-segment-aware command context: for filesystem commands (cd, cat, ls, rm, etc.)
 * bare blocked directory names are extracted with priority. For non-filesystem commands
 * (grep, echo, sed, etc.) only tokens that structurally look like paths are extracted,
 * preventing false positives on search terms and string arguments. Values of free-text
 * flags (-m, --body, --repro, ... on git/gh/ak and similar) and quoted echo/printf
 * arguments are text, never paths. Inline scripts (`node -e "..."`) are treated as text
 * too, so a script that reads a blocked file itself is not detected. Redirect targets
 * (`> dist/x`) are always checked.
 *
 * PowerShell commands additionally recognize the filesystem cmdlets and their
 * aliases (Get-ChildItem node_modules, gc dist\app.js), Select-String's
 * -Pattern as a search term, and the `-Path:value` single-token form.
 *
 * @param {string} command - The command string
 * @param {Object} [options]
 * @param {string} [options.dialect] - 'posix' (default) or 'powershell'
 * @returns {string[]} Array of extracted paths
 */
function extractFromCommand(command, options = {}) {
  if (!command || typeof command !== 'string') {
    return [];
  }

  const powershell = options.dialect === POWERSHELL_DIALECT;
  const isFilesystemCommand = name => FILESYSTEM_COMMANDS.includes(name)
    || (powershell && POWERSHELL_FILESYSTEM_COMMANDS.includes(name));
  const isPatternArgCommand = name => PATTERN_ARG_COMMANDS.includes(name)
    || (powershell && POWERSHELL_PATTERN_ARG_COMMANDS.includes(name));
  const isPatternFlag = flag => isExcludeFlag(flag, powershell) || PATTERN_ARG_FLAGS.includes(flag)
    || (powershell && POWERSHELL_PATTERN_ARG_FLAGS.includes(powerShellParameterName(flag)));
  const paths = [];

  const { tokens, substitutions } = tokenizeShell(command, powershell);

  // A command substitution runs as a command of its own. Past the nesting cap
  // its text is checked whole, so deep nesting cannot overflow the stack.
  const depth = options.substitutionDepth || 0;
  for (const inner of substitutions) {
    if (depth >= MAX_SUBSTITUTION_DEPTH) {
      paths.push(normalizeExtractedPath(inner));
    } else {
      paths.push(...extractFromCommand(inner, { ...options, substitutionDepth: depth + 1 }));
    }
  }

  // Track command context per pipe segment
  let commandName = null;
  let isFsCommand = false;
  let skipNextToken = false;
  let nextIsPathValue = false;
  let nextIsPattern = false;
  let nextIsRedirectTarget = false;
  const isTextFlag = flag => TEXT_FLAG_COMMANDS.includes(commandName) && TEXT_ARG_FLAGS.includes(flag);

  const resetSegment = () => {
    commandName = null;
    isFsCommand = false;
    skipNextToken = false;
    nextIsPathValue = false;
    nextIsPattern = false;
    nextIsRedirectTarget = false;
  };

  for (const tok of tokens) {
    if (tok.type === 'op') {
      if (['<<<'].includes(tok.text)) {
        skipNextToken = true; // a here-string is text fed on stdin
      } else if (/^[<>]/.test(tok.text)) {
        // A redirect target is a file the shell opens, whatever the command.
        if (tok.text !== '<<' && tok.text !== '<<-') nextIsRedirectTarget = true;
      } else {
        resetSegment(); // command, pipe, and subshell boundaries
      }
      continue;
    }

    const rawToken = tok.text;
    if (nextIsRedirectTarget) {
      nextIsRedirectTarget = false;
      if (isBlockedDirName(rawToken.trim()) || looksLikePath(rawToken)) {
        paths.push(normalizeExtractedPath(rawToken));
      }
      continue;
    }
    const afterPatternFlag = nextIsPattern;
    nextIsPattern = false;

    // `-Path:node_modules` names its path in the same token as the parameter.
    const colonParameter = powershell ? rawToken.match(POWERSHELL_COLON_PARAMETER) : null;
    const token = colonParameter ? colonParameter[2] : rawToken;
    const isPathValue = nextIsPathValue || Boolean(colonParameter && isPowerShellPathParameter(colonParameter[1], powershell));
    nextIsPathValue = false;

    // A PowerShell -Path/-LiteralPath value is a path for every cmdlet.
    if (isPathValue && !isSkippableToken(token)) {
      const bare = token.trim();
      if (isBlockedDirName(bare) || looksLikePath(token)) {
        paths.push(normalizeExtractedPath(token));
      }
      continue;
    }
    if (colonParameter) continue;

    // Skip the value after exclude and free-text flags
    if (skipNextToken) {
      skipNextToken = false;
      continue;
    }

    // Flags: `--exclude node_modules`, `-m "message"`, `--body=text`, ...
    if (token.startsWith('-')) {
      const { flag, value } = splitFlagValue(token);
      if (value !== null) {
        if (isTextFlag(flag) || isPatternFlag(flag)) continue;
        // A quoted `--out="dist/x"` value is a path; an unquoted one stays a flag.
        if (tok.quoted && looksLikePath(value)) paths.push(normalizeExtractedPath(value));
        continue;
      }
      if (isPowerShellPathParameter(token, powershell)) {
        nextIsPathValue = true;
      } else if (isTextFlag(token) || isExcludeFlag(token, powershell)) {
        skipNextToken = true;
      } else if (isPatternFlag(token)) {
        nextIsPattern = true;
      }
      continue;
    }

    // Environment assignments and wrappers (sudo, env, time, ...) come before the command.
    if (commandName === null && /^\w+=/.test(token)) {
      const value = token.slice(token.indexOf('=') + 1);
      if (tok.quoted && looksLikePath(value)) paths.push(normalizeExtractedPath(value));
      continue;
    }
    if (commandName === null && !tok.quoted && COMMAND_WRAPPERS.includes(token.toLowerCase())) continue;

    if (tok.quoted) {
      // Quoted words keep spaces in real paths. A quoted argument is only a
      // path where the command takes a path: arguments to filter/pattern
      // commands, pattern-flag values, and text to print are not.
      if (commandName === null) {
        commandName = token.toLowerCase();
        isFsCommand = isFilesystemCommand(commandName);
        if (isFsCommand) continue;
      } else {
        if (/^s[\/|@#,]/.test(token)) continue; // sed/awk substitution
        if (isPatternArgCommand(commandName) || TEXT_ARG_COMMANDS.includes(commandName)) continue;
        if (afterPatternFlag) continue;
        const bare = token.trim();
        if (isFsCommand && isBlockedDirName(bare)) {
          paths.push(normalizeExtractedPath(bare));
          continue;
        }
      }
      if (looksLikePath(token)) {
        paths.push(normalizeExtractedPath(token));
      }
      continue;
    }

    // Skip operators glued to words and numeric values
    if (isSkippableToken(token)) continue;

    // Determine the command for this pipe segment (first non-flag token)
    if (commandName === null) {
      commandName = token.toLowerCase();
      isFsCommand = isFilesystemCommand(commandName);
      // Skip the command word itself
      if (isCommandKeyword(token) || isFsCommand) continue;
      // Non-keyword command (e.g., ./script.sh) — fall through to path check
    }

    // For filesystem commands, extract blocked dir names with priority.
    // "cd build", "ls dist", "cat node_modules/..." — "build"/"dist" are paths here.
    if (isFsCommand && isBlockedDirName(token)) {
      paths.push(normalizeExtractedPath(token));
      continue;
    }

    // Skip common non-path command words
    if (isCommandKeyword(token)) continue;

    // Unquoted sed/awk substitution or address expressions (s/pat/repl/,
    // s|pat|repl|, ...) are structurally never real paths. An unquoted
    // argument to a filter command is NOT exempted in general, since an
    // unquoted trailing argument is usually the real target file.
    if (commandName && isPatternArgCommand(commandName) && /^s[\/|@#,]/.test(token)) {
      continue;
    }

    // Check if it looks like a path
    if (looksLikePath(token)) {
      paths.push(normalizeExtractedPath(token));
    }
  }

  return paths;
}

/**
 * Resolve the command context that governs a quoted string at a given index.
 *
 * Only the current pipe/compound segment is considered — the text after the
 * last &&, ||, ;, |, or newline boundary preceding the quote — so a quoted arg
 * is classified by the command it actually belongs to. On pathological quoting
 * the split can land inside an earlier quoted string and misresolve the
 * governing command; the usual outcome is a non-command token, which preserves
 * extraction rather than suppressing it.
 *
 * @param {string} command - Full command string
 * @param {number} index - Start index of the opening quote in `command`
 * @param {Object} [options]
 * @param {string} [options.dialect] - 'posix' (default) or 'powershell'
 * @returns {{ command: (string|null), precededByPatternFlag: boolean, precededByPathParameter: boolean }}
 */
function quotedArgContext(command, index, options = {}) {
  const prefix = command.slice(0, index);
  const segments = prefix.split(/&&|\|\||;|\||\n/);
  const segment = segments[segments.length - 1];
  const words = segment.trim().split(/\s+/).filter(Boolean);

  let commandName = null;
  for (const word of words) {
    if (/^\w+=/.test(word)) continue;              // env assignment (KEY=value)
    if (COMMAND_WRAPPERS.includes(word)) continue; // sudo/env/time/...
    if (word.startsWith('-')) continue;            // flags
    commandName = word.toLowerCase();
    break;
  }

  // The flag immediately before the quote (with a trailing `=` stripped so the
  // `--exclude="..."` and `--exclude "..."` forms both match).
  const powershell = options.dialect === POWERSHELL_DIALECT;
  const lastWord = words.length ? words[words.length - 1] : '';
  const normalizedFlag = lastWord.replace(/=$/, '');
  const precededByPatternFlag =
    isExcludeFlag(normalizedFlag, powershell) || PATTERN_ARG_FLAGS.includes(normalizedFlag) ||
    (powershell && POWERSHELL_PATTERN_ARG_FLAGS.includes(powerShellParameterName(normalizedFlag)));
  const precededByPathParameter = isPowerShellPathParameter(normalizedFlag, powershell);

  return { command: commandName, precededByPatternFlag, precededByPathParameter };
}

// Common blocked directory names that should be extracted even if they
// match command keywords (e.g., "build" is both a subcommand and a dir name)
// Keep in sync with DEFAULT_PATTERNS in pattern-matcher.cjs
const BLOCKED_DIR_NAMES = [
  'node_modules', '__pycache__', '.git', 'dist', 'build',
  '.next', '.nuxt', '.venv', 'venv', 'vendor', 'target', 'coverage'
];

/**
 * Check if token is exactly a blocked directory name
 * This takes priority over command keyword filtering
 *
 * @param {string} token - Token to check
 * @returns {boolean}
 */
function isBlockedDirName(token) {
  return BLOCKED_DIR_NAMES.includes(token);
}

/**
 * Check if a string looks like a file path
 *
 * @param {string} str - String to check
 * @returns {boolean}
 */
function looksLikePath(str) {
  if (!str || str.length < 2) return false;

  // Contains path separator
  if (str.includes('/') || str.includes('\\')) return true;

  // Starts with relative path indicator
  if (str.startsWith('./') || str.startsWith('../')) return true;

  // Has file extension (likely a file)
  if (/\.\w{1,6}$/.test(str)) return true;

  // Looks like a directory path
  if (/^[a-zA-Z0-9_-]+\//.test(str)) return true;

  return false;
}

/**
 * Check if token should be skipped (flags, operators)
 *
 * @param {string} token - Token to check
 * @returns {boolean}
 */
function isSkippableToken(token) {
  // Flags
  if (token.startsWith('-')) return true;

  // Shell operators
  if (['|', '||', '&&', '>', '>>', '<', '<<', '&', ';'].includes(token)) return true;
  if (token.startsWith('|') || token.startsWith('>') || token.startsWith('<')) return true;
  if (token.startsWith('&')) return true;

  // Numeric values
  if (/^\d+$/.test(token)) return true;

  return false;
}

/**
 * Check if token is a common command keyword (not a path)
 *
 * @param {string} token - Token to check
 * @returns {boolean}
 */
function isCommandKeyword(token) {
  const keywords = [
    // Shell commands
    'echo', 'cat', 'ls', 'cd', 'rm', 'cp', 'mv', 'find', 'grep', 'head', 'tail',
    'wc', 'du', 'tree', 'touch', 'mkdir', 'rmdir', 'pwd', 'which', 'env', 'export',
    'source', 'bash', 'sh', 'zsh', 'true', 'false', 'test', 'xargs', 'tee', 'sort',
    'uniq', 'cut', 'tr', 'sed', 'awk', 'diff', 'chmod', 'chown', 'ln', 'file',

    // Package managers and their subcommands
    'npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'node',
    'run', 'build', 'test', 'lint', 'dev', 'start', 'install', 'ci', 'exec',
    'add', 'remove', 'update', 'publish', 'pack', 'init', 'create',

    // Build tools
    'tsc', 'esbuild', 'vite', 'webpack', 'rollup', 'turbo', 'nx',
    'jest', 'vitest', 'mocha', 'eslint', 'prettier',

    // Git
    'git', 'commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'branch',
    'status', 'log', 'diff', 'add', 'reset', 'stash', 'fetch', 'clone',

    // Docker
    'docker', 'compose', 'up', 'down', 'ps', 'logs', 'exec', 'container', 'image',

    // Misc
    'sudo', 'time', 'timeout', 'watch', 'make', 'cargo', 'python', 'python3', 'pip',
    'ruby', 'gem', 'go', 'rust', 'java', 'javac', 'mvn', 'gradle'
  ];

  return keywords.includes(token.toLowerCase());
}

/**
 * Normalize an extracted path
 * - Remove surrounding quotes
 * - Normalize path separators to forward slash
 *
 * @param {string} path - Path to normalize
 * @returns {string} Normalized path
 */
function normalizeExtractedPath(path) {
  if (!path) return '';

  let normalized = path.trim();

  // Remove surrounding quotes
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }

  // Strip shell metacharacters from edges (backticks, parens, braces)
  normalized = normalized.replace(/^[`({\[]+/, '').replace(/[`)};\]]+$/, '');

  // Normalize path separators to forward slash
  normalized = normalized.replace(/\\/g, '/');

  // Remove trailing slash for consistency
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

module.exports = {
  extractFromToolInput,
  extractFromCommand,
  tokenizeShell,
  quotedArgContext,
  looksLikePath,
  isSkippableToken,
  isCommandKeyword,
  isBlockedDirName,
  normalizeExtractedPath,
  BLOCKED_DIR_NAMES,
  EXCLUDE_FLAGS,
  FILESYSTEM_COMMANDS,
  PATTERN_ARG_COMMANDS,
  PATTERN_ARG_FLAGS,
  TEXT_ARG_FLAGS,
  TEXT_ARG_COMMANDS,
  POWERSHELL_FILESYSTEM_COMMANDS,
  POWERSHELL_PATTERN_ARG_COMMANDS
};
