// The few tools the analysis agents need beyond the MCP servers, for the built-in agent loop (lib/agent-loop.js):
//   Bash   - NOT a shell. Exactly two kinds of command exist: the repository helper (qa-git.sh prepare / find / refs / git)
//            and the agents' own validate-*.sh report checkers. Words are split by hand and run without a shell, so
//            pipes, redirects, `cd x && ...` and `$(...)` do not exist. Folders given to a script must be the run's own.
//   Write / Edit - only inside the run's working folder.
//   Skill  - reads a skill's instructions from the agent's folder.
// Why so strict: on a shared host an unrestricted shell would read other customers' folders.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** Splits a command line into words, honouring quotes. Returns { words } or { error } when an operator is used. */
function tokenize(cmd) {
  const words = []; let cur = '', has = false, q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && /["\\]/.test(cmd[i + 1] || '')) cur += cmd[++i];
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c === '\n' || c === '\r') return { error: 'Not allowed: new line. Run one simple command per call.' };
    else if (/\s/.test(c)) { if (has || cur) { words.push(cur); cur = ''; has = false; } }
    else if (/[;&|<>()`$\n\r{}*?~]/.test(c)) return { error: `Not allowed: "${c === '\n' ? 'new line' : c}". Run one simple command per call, without pipes, redirects, variables or wildcards.` };
    else if (c === '\\') { cur += cmd[++i] || ''; has = true; }
    else { cur += c; has = true; }
  }
  if (q) return { error: 'A quote is not closed.' };
  if (has || cur) words.push(cur);
  return { words };
}

const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return null; } };
const inside = (p, roots) => roots.some((r) => p === r || p.startsWith(r + path.sep));

/**
 * opts: { workDir, cwd, qaGit (absolute path of qa-git.sh), validateRoots: [folders holding validate-*.sh], env, timeoutMs }
 * Returns { description, schema, run({command}) -> text }.
 */
function shellTool(opts) {
  const workReal = real(opts.workDir);
  const gitReal = opts.qaGit ? real(opts.qaGit) : null;
  const vRoots = (opts.validateRoots || []).map(real).filter(Boolean);
  const isValidator = (abs) => /^validate-[\w-]+\.sh$/.test(path.basename(abs)) && inside(abs, vRoots);
  return {
    description: 'Runs ONE simple command. Allowed: bash "<path of qa-git.sh>" prepare|find|refs|git ..., and bash .claude/skills/<skill>/scripts/validate-<name>.sh --report "<file>". No pipes, no cd, no redirects, no variables.',
    schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    run(a) {
      return new Promise((resolve, reject) => {
        const t = tokenize(String(a.command || '').trim());
        if (t.error) return reject(new Error(t.error));
        const [prog, script, ...args] = t.words;
        if (prog !== 'bash' || !script) return reject(new Error('Only commands of the form: bash <script> <arguments> are allowed.'));
        const abs = real(path.resolve(opts.cwd, script));
        if (!abs) return reject(new Error('Script not found: ' + script));
        const isGit = !!gitReal && abs === gitReal;
        if (!isGit && !isValidator(abs)) return reject(new Error('This script is not allowed. Allowed: qa-git.sh and the validate-*.sh checkers of your skills.'));
        // Any folder handed to a script must be inside the run's own working folder.
        const valueOf = (x) => (x.startsWith('-') && x.includes('=') ? x.slice(x.indexOf('=') + 1) : x);
        const pathArgs = isGit ? (args[0] === 'prepare' ? [args[3]] : []) : args.map(valueOf).filter((x) => /[\\/]/.test(x));
        const workAbs = path.resolve(opts.workDir);
        for (const x of pathArgs.filter(Boolean)) {
          const r = path.resolve(opts.cwd, x);
          if (!inside(r, [workAbs, workReal].filter(Boolean)) && !inside(real(r) || '', [workReal].filter(Boolean))) return reject(new Error('Folders given to a script must be inside the working folder: ' + x));
        }
        const proc = spawn('bash', [abs, ...args], { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let out = '', err = '';
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } }, opts.timeoutMs || 300000);
        proc.stdout.on('data', (c) => { if (out.length < 200000) out += c; });
        proc.stderr.on('data', (c) => { if (err.length < 50000) err += c; });
        proc.on('error', (e) => { clearTimeout(timer); reject(new Error('Could not run bash: ' + e.message)); });
        proc.on('close', (code) => { clearTimeout(timer); const text = [out.trim(), err.trim() && `[stderr] ${err.trim()}`].filter(Boolean).join('\n'); code === 0 ? resolve(text || '(no output)') : reject(new Error(`Exit code ${code}. ${text}`.slice(0, 6000))); });
      });
    },
  };
}

/** Write and Edit, limited to the given folders. */
function writeTools(roots) {
  const real_ = roots.map(real).filter(Boolean);
  const target = (p) => {
    const abs = path.resolve(real_[0] || '.', String(p || ''));
    const parent = real(path.dirname(abs)) || null;
    // The folder may not exist yet: walk up to the first one that does and check that one.
    let up = path.dirname(abs), found = parent;
    while (!found && up !== path.dirname(up)) { up = path.dirname(up); found = real(up); }
    if (!found || !inside(found, real_)) throw new Error('Writing is allowed only inside the working folder: ' + p);
    if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) throw new Error('Not allowed: ' + p);
    return abs;
  };
  return {
    Write: {
      description: 'Creates or overwrites a text file inside the working folder.',
      schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run(a) {
        const f = target(a.path); const c = String(a.content == null ? '' : a.content);
        if (c.length > 2000000) throw new Error('The file is too large.');
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c);
        return `Wrote ${c.length} characters to ${a.path}`;
      },
    },
    Edit: {
      description: 'Replaces text in a file inside the working folder. old_string must occur exactly once unless replace_all is true.',
      schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] },
      run(a) {
        const f = target(a.path);
        if (!fs.existsSync(f)) throw new Error('Not found: ' + a.path);
        const txt = fs.readFileSync(f, 'utf8'); const n = txt.split(a.old_string).length - 1;
        if (!a.old_string || n === 0) throw new Error('old_string was not found.');
        if (n > 1 && !a.replace_all) throw new Error(`old_string occurs ${n} times; make it unique or set replace_all.`);
        fs.writeFileSync(f, a.replace_all ? txt.split(a.old_string).join(a.new_string) : txt.replace(a.old_string, () => a.new_string));
        return `Edited ${a.path} (${a.replace_all ? n : 1} change${n > 1 && a.replace_all ? 's' : ''})`;
      },
    },
  };
}

/** Skill: returns the SKILL.md of a named skill from the agent's folder(s). */
function skillTool(dirs) {
  const find = (name) => { for (const d of dirs) { const f = path.join(d, String(name || '').replace(/[^\w.-]/g, ''), 'SKILL.md'); if (fs.existsSync(f)) return f; } return null; };
  return {
    description: 'Loads the instructions of a skill by name (for example spec-checks).',
    schema: { type: 'object', properties: { skill: { type: 'string' } }, required: ['skill'] },
    run(a) {
      const f = find(a.skill);
      if (!f) { const names = dirs.flatMap((d) => { try { return fs.readdirSync(d); } catch (_) { return []; } }); throw new Error(`No skill named ${a.skill}. Available: ${names.join(', ') || 'none'}`); }
      return `Skill folder: ${path.dirname(f)}\n\n` + fs.readFileSync(f, 'utf8');
    },
  };
}

module.exports = { shellTool, skillTool, tokenize, writeTools };
