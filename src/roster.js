'use strict';

/*
 * Roster maintenance.
 *
 * Handles were previously changed by hand-editing handles.json, which is why
 * four people have been sitting unconnected: the work needed someone willing to
 * edit JSON and recount rows. This is the same job as a command, with the
 * safety rails the file's invariants imply — a confirmation always carries its
 * evidence, a duplicate handle is refused, and any roster change bumps the
 * version so no snapshot stamped against the old roster can keep ranking.
 *
 *   node src/roster.js status
 *   node src/roster.js pending
 *   node src/roster.js set-handle "Full Name" instagram some.handle
 *   node src/roster.js confirm "Full Name" --evidence "bio tags @kirpa.properties"
 *   node src/roster.js unconfirm "Full Name" --reason "wrong person"
 *   node src/roster.js opt-out "Full Name" --reason "asked to be excluded"
 *   node src/roster.js opt-in "Full Name"
 *   node src/roster.js target "Full Name" postsPerWeek 4
 *   node src/roster.js verify
 */

const fs = require('fs');
const path = require('path');

const REGISTRY = process.env.KIRPA_REGISTRY || 'handles.json';

function load(file = REGISTRY) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function canonicalHandle(value) {
  return value == null ? null : String(value).replace(/^@/, '').trim().toLowerCase();
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

/*
 * A roster change invalidates every snapshot measured against the previous
 * roster; the dashboard enforces that by version equality. Bumping here is
 * therefore not bookkeeping, it is the thing that stops stale rankings.
 */
function bumpVersion(current) {
  const day = today();
  const match = String(current || '').match(/^(\d{4}-\d{2}-\d{2})-(.+)-v(\d+)$/);
  if (match && match[1] === day) return `${day}-${match[2]}-v${Number(match[3]) + 1}`;
  const label = match ? match[2] : 'kirpa-roster';
  return `${day}-${label}-v1`;
}

function findEmployee(registry, name) {
  const wanted = String(name || '').trim().toLowerCase();
  const exact = registry.employees.filter(employee => employee.name.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = registry.employees.filter(employee => employee.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`"${name}" matches ${partial.length} people: ${partial.map(person => person.name).join(', ')}`);
  }
  throw new Error(`No roster entry matches "${name}"`);
}

function verify(registry) {
  const problems = [];
  const employees = registry.employees || [];
  if (!registry.rosterVersion) problems.push('rosterVersion is missing');
  if (employees.length !== registry.rosterRowCount) {
    problems.push(`rosterRowCount is ${registry.rosterRowCount} but the file holds ${employees.length} employees`);
  }
  const names = employees.map(employee => employee.name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length) problems.push(`duplicate names: ${[...new Set(duplicateNames)].join(', ')}`);
  const perPlatform = new Map();
  for (const employee of employees) {
    for (const [platform, handle] of Object.entries(employee.handles || {})) {
      if (!handle) continue;
      const key = `${platform}:${canonicalHandle(handle)}`;
      if (perPlatform.has(key)) problems.push(`${platform} handle @${handle} is shared by ${perPlatform.get(key)} and ${employee.name}`);
      else perPlatform.set(key, employee.name);
    }
    if (employee.confirmed === true && !canonicalHandle(employee.handles?.instagram)) {
      problems.push(`${employee.name} is confirmed but has no Instagram handle`);
    }
    if (employee.confirmed === true && !employee.verifiedFromBio && !employee.sourcedFrom && !employee.evidence) {
      problems.push(`${employee.name} is confirmed with no recorded evidence`);
    }
    if (employee.optOut === true && canonicalHandle(employee.handles?.instagram)) {
      problems.push(`${employee.name} opted out but a handle is still published in the registry`);
    }
  }
  for (const account of registry.brandAccounts || []) {
    if (account.confirmed === true && !account.handle) problems.push(`brand account ${account.name} is confirmed with no handle`);
  }
  return problems;
}

function save(registry, file = REGISTRY, { bump = true } = {}) {
  const problems = verify(registry);
  if (problems.length) {
    throw new Error(`Refusing to write an inconsistent roster:\n - ${problems.join('\n - ')}`);
  }
  if (bump) registry.rosterVersion = bumpVersion(registry.rosterVersion);
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const commands = {
  status(registry) {
    const employees = registry.employees.filter(employee => employee.dashboardRelevant !== false);
    const confirmed = employees.filter(employee => employee.confirmed === true && employee.optOut !== true);
    const optedOut = registry.employees.filter(employee => employee.optOut === true);
    const noHandle = employees.filter(employee => !employee.handles?.instagram && employee.optOut !== true);
    console.log(`roster ${registry.rosterVersion}`);
    console.log(`  ${registry.employees.length} people (${employees.length} dashboard-relevant)`);
    console.log(`  ${confirmed.length} confirmed Instagram handles`);
    console.log(`  ${noHandle.length} without a handle: ${noHandle.map(employee => employee.name).join(', ') || 'none'}`);
    console.log(`  ${optedOut.length} opted out: ${optedOut.map(employee => employee.name).join(', ') || 'none'}`);
    console.log(`  active platforms: ${(registry.activePlatforms || ['instagram']).join(', ')}`);
    const problems = verify(registry);
    console.log(problems.length ? `  PROBLEMS:\n   - ${problems.join('\n   - ')}` : '  integrity: ok');
  },
  pending(registry) {
    const rows = registry.employees.filter(employee => (
      employee.dashboardRelevant !== false && employee.optOut !== true &&
      (employee.confirmed !== true || employee.needsHumanConfirmation === true)
    ));
    if (!rows.length) return console.log('Nothing pending — every relevant profile is confirmed.');
    for (const employee of rows) {
      const handle = employee.handles?.instagram;
      console.log(`- ${employee.name} (${employee.role || 'role unknown'})`);
      console.log(`    handle: ${handle ? `@${handle}` : 'none recorded'}`);
      console.log(`    state: ${employee.confirmed === true ? 'confirmed, awaiting human check' : 'unconfirmed'}`);
      if (employee.notes) console.log(`    notes: ${employee.notes}`);
    }
  },
  'set-handle'(registry, [name, platform, handle]) {
    if (!name || !platform || !handle) throw new Error('usage: set-handle "Name" <platform> <handle>');
    const employee = findEmployee(registry, name);
    const clean = canonicalHandle(handle);
    const clash = registry.employees.find(other => (
      other !== employee && canonicalHandle(other.handles?.[platform]) === clean
    ));
    if (clash) throw new Error(`@${clean} is already recorded for ${clash.name}`);
    employee.handles = employee.handles || {};
    employee.handles[platform] = clean;
    /*
     * A new handle is a claim, not a fact. Setting one always drops the
     * confirmation, so nothing is pulled until a human records the evidence.
     */
    employee.confirmed = false;
    employee.needsHumanConfirmation = true;
    save(registry);
    console.log(`${employee.name}: ${platform} handle set to @${clean}, confirmation cleared. Confirm it with evidence before the next pull.`);
  },
  confirm(registry, [name]) {
    const evidence = flag('evidence');
    if (!name || !evidence) throw new Error('usage: confirm "Name" --evidence "what proves this is them"');
    const employee = findEmployee(registry, name);
    if (!employee.handles?.instagram) throw new Error(`${employee.name} has no Instagram handle to confirm`);
    if (employee.optOut === true) throw new Error(`${employee.name} has opted out; run opt-in first`);
    employee.confirmed = true;
    employee.needsHumanConfirmation = false;
    employee.evidence = `${today()} ${evidence}`;
    employee.evidenceClass = flag('class', employee.evidenceClass || 'human-confirmed');
    save(registry);
    console.log(`${employee.name}: confirmed. Roster is now ${registry.rosterVersion}; the next validated pull will include them.`);
  },
  unconfirm(registry, [name]) {
    const reason = flag('reason');
    if (!name || !reason) throw new Error('usage: unconfirm "Name" --reason "why"');
    const employee = findEmployee(registry, name);
    employee.confirmed = false;
    employee.needsHumanConfirmation = true;
    employee.notes = `${today()} unconfirmed: ${reason}${employee.notes ? ` | ${employee.notes}` : ''}`;
    save(registry);
    console.log(`${employee.name}: confirmation removed. They will not be pulled again until re-confirmed.`);
  },
  'opt-out'(registry, [name]) {
    const reason = flag('reason', 'requested by the individual');
    const employee = findEmployee(registry, name);
    const previous = employee.handles?.instagram || null;
    employee.optOut = true;
    employee.optOutRecordedAt = today();
    employee.optOutReason = reason;
    employee.confirmed = false;
    /*
     * The registry is published beside the dashboard, so honouring an opt-out
     * means removing the handle from the file as well as from the rankings.
     */
    if (employee.handles) employee.handles = {};
    save(registry);
    console.log(`${employee.name}: opted out${previous ? ` and @${previous} removed from the published registry` : ''}. They keep a roster row and are excluded from every metric.`);
  },
  'opt-in'(registry, [name]) {
    const employee = findEmployee(registry, name);
    delete employee.optOut;
    delete employee.optOutReason;
    delete employee.optOutRecordedAt;
    save(registry);
    console.log(`${employee.name}: opt-out lifted. Add a handle and confirm it to bring them back onto the board.`);
  },
  target(registry, [name, metric, value]) {
    if (!name || !metric || value === undefined) throw new Error('usage: target "Name" <metric> <value>  (metric: postsPerWeek | engagementRate, or "team" as the name)');
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`target must be a positive number, got ${value}`);
    if (name.toLowerCase() === 'team') {
      registry.targets = Object.assign({}, registry.targets, { [metric]: parsed });
      save(registry, REGISTRY, { bump: false });
      return console.log(`Team target ${metric} set to ${parsed}.`);
    }
    const employee = findEmployee(registry, name);
    employee.targets = Object.assign({}, employee.targets, { [metric]: parsed });
    save(registry, REGISTRY, { bump: false });
    console.log(`${employee.name}: ${metric} target set to ${parsed}.`);
  },
  verify(registry) {
    const problems = verify(registry);
    if (!problems.length) return console.log(`Roster ${registry.rosterVersion} is internally consistent.`);
    console.error(`Roster problems:\n - ${problems.join('\n - ')}`);
    process.exitCode = 1;
  },
};

function main() {
  const [command, ...rest] = process.argv.slice(2).filter(value => !value.startsWith('--'));
  const registry = load();
  const handler = commands[command || 'status'];
  if (!handler) {
    console.error(`Unknown command "${command}". Available: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  handler(registry, rest);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(String(error.message || error)); process.exitCode = 1; }
}

module.exports = { load, save, verify, bumpVersion, findEmployee, canonicalHandle };
