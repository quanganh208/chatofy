import io
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import session_usage  # noqa: E402


def ts(second):
    return f'2026-09-01T10:00:{second:02d}.000Z'


def assistant(second, msg_id, blocks, usage=None, **extra):
    usage = usage or {'input_tokens': 1, 'cache_read_input_tokens': 100, 'cache_creation_input_tokens': 5,
                      'output_tokens': 20, 'output_tokens_details': {'thinking_tokens': 4}}
    return {'type': 'assistant', 'timestamp': ts(second), 'sessionId': 'sess-claude-1', 'entrypoint': 'cli',
            'message': {'id': msg_id, 'model': 'main-model', 'content': blocks, 'usage': usage}, **extra}


def user(second, content, **extra):
    return {'type': 'user', 'timestamp': ts(second), 'sessionId': 'sess-claude-1', 'message': {'role': 'user', 'content': content}, **extra}


def tool_use(tool_id, name, data):
    return {'type': 'tool_use', 'id': tool_id, 'name': name, 'input': data}


def result(tool_id, is_error=False):
    return [{'type': 'tool_result', 'tool_use_id': tool_id, 'content': 'ok', 'is_error': is_error}]


def write_jsonl(path, events):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(e) + '\n' for e in events), encoding='utf-8')


class SessionUsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        skill = self.root / 'skills' / 'ak-demo-skill'
        skill.mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: ak:demo-skill\nargument-hint: "<audit|optimize> [path]"\n---\n', encoding='utf-8')
        self.sid = session_usage.SkillId(str(skill))

    def tearDown(self):
        self.tmp.cleanup()

    def claude_fixture(self):
        guide = {'file_path': '/home/u/.claude/skills/ak-demo-skill/references/guide.md'}
        path = self.root / 'claude' / 'proj' / 'sess-claude-1.jsonl'
        write_jsonl(path, [
            user(0, '<command-message>ak-demo-skill</command-message>\n<command-name>/ak-demo-skill</command-name>\n<command-args>audit the thing</command-args>'),
            user(0, [{'type': 'text', 'text': 'Base directory for this skill'}], isMeta=True),
            assistant(1, 'm1', [tool_use('t1', 'Read', guide)]),
            user(3, result('t1')),
            assistant(4, 'm2', [tool_use('t2', 'Bash', {'command': 'python C:\\s\\ak-demo-skill\\scripts\\run.py\\n'})]),
            user(10, result('t2', is_error=True)),
            assistant(11, 'm2', [tool_use('t3', 'Read', guide)]),
            user(12, result('t3')),
            assistant(13, 'm3', [tool_use('t4', 'Agent', {'subagent_type': 'scout', 'model': 'small', 'prompt': 'x'})]),
            user(40, result('t4')),
            user(41, [{'type': 'text', 'text': '[Request interrupted by user]'}]),
            user(50, 'thanks, now something else'),
            assistant(51, 'm4', [tool_use('t5', 'Read', {'file_path': 'x'})]),
        ])
        write_jsonl(path.with_suffix('') / 'subagents' / 'agent-a.jsonl', [
            {'type': 'assistant', 'timestamp': ts(15), 'isSidechain': True,
             'message': {'id': 's1', 'model': 'small-model', 'content': [], 'usage': {'input_tokens': 2, 'output_tokens': 7}}},
        ])
        return path

    def test_claude_slash_invocation_metrics(self):
        records = list(session_usage.claude_invocations(self.claude_fixture(), self.sid))
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual((r['trigger'], r['subcommand'], r['entrypoint'], r['session']), ('user', 'audit', 'cli', 'sess-cla'))
        self.assertEqual(r['turns'], 3)
        self.assertEqual(r['tokens'], {'input': 3, 'cache_read': 300, 'cache_write': 15, 'output': 60, 'reasoning': 12})
        self.assertEqual((r['tool_calls'], r['tool_errors'], r['duplicate_calls'], r['interruptions']), (4, 1, 1, 1))
        self.assertEqual(r['errors_by_tool'], {'Bash': 1})
        self.assertEqual(r['skill_files'], {'references/guide.md': 2, 'scripts/run.py': 1})
        self.assertEqual(r['delegations'], {'scout@small': 1})
        self.assertEqual(r['subagent']['runs'], 1)
        self.assertEqual(r['subagent']['tokens']['output'], 7)
        self.assertEqual(r['subagent']['models'], {'small-model': 1})
        self.assertEqual(r['duration_s'], 40.0)
        self.assertEqual(r['tool_latency_s']['Agent'], 27.0)

    def test_claude_compaction_and_injected_events_do_not_end_span(self):
        path = self.root / 'claude' / 'p' / 'c.jsonl'
        write_jsonl(path, [
            user(0, '<command-name>/ak-demo-skill</command-name>\n<command-args>optimize x</command-args>'),
            assistant(1, 'm1', [tool_use('t1', 'Read', {'file_path': 'a'})]),
            user(2, 'This session is being continued from a previous conversation.', isCompactSummary=True),
            user(3, '<ci-monitor-event>checks green</ci-monitor-event>'),
            assistant(4, 'm2', [tool_use('t2', 'Read', {'file_path': 'b'})]),
            assistant(4, 's1', [], {'output_tokens': 9}, isSidechain=True),
            assistant(4, 's1', [], {'output_tokens': 9}, isSidechain=True),
            user(5, 'done'),
        ])
        [r] = session_usage.claude_invocations(path, self.sid)
        self.assertEqual((r['turns'], r['tool_calls'], r['subagent']['tokens']['output']), (2, 2, 9))

    def test_claude_plugin_namespaced_slash_command(self):
        path = self.root / 'claude' / 'p' / 'n.jsonl'
        write_jsonl(path, [
            user(0, '<command-name>/ak-core:ak-demo-skill</command-name>\n<command-args>audit x</command-args>'),
            user(1, '<command-name>/ak-core:ak-demo-skill-extra</command-name>'),
        ])
        records = list(session_usage.claude_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['subcommand']) for r in records], [('user', 'audit')])

    def test_claude_model_invocation_and_foreign_skill(self):
        path = self.root / 'claude' / 'p' / 's.jsonl'
        write_jsonl(path, [
            user(0, 'please improve the skill'),
            assistant(1, 'm1', [tool_use('t1', 'Skill', {'skill': 'ak-demo-skill', 'args': 'optimize kits/x'})]),
            user(2, result('t1')),
            assistant(3, 'm2', [tool_use('t2', 'Skill', {'skill': 'ak-other'})]),
            assistant(4, 'm3', [tool_use('t3', 'Skill', {'skill': 'plugin:ak-demo-skill-extra'})]),
        ])
        records = list(session_usage.claude_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['subcommand']) for r in records], [('model', 'optimize')])
        self.assertEqual(records[0]['skills_chained'], {'ak-other': 1, 'plugin:ak-demo-skill-extra': 1})

    def test_codex_invocation_uses_token_deltas_and_exit_codes(self):
        path = self.root / 'codex' / '2026' / 'rollout-1.jsonl'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}

        def tokens(second, inp, cached, out, reasoning=0):
            return item(second, {'type': 'token_count', 'info': {'total_token_usage': {
                'input_tokens': inp, 'cached_input_tokens': cached, 'output_tokens': out, 'reasoning_output_tokens': reasoning}}}, 'event_msg')

        def message(second, text):
            return item(second, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]})

        write_jsonl(path, [
            item(0, {'id': 'codex-session-9', 'originator': 'codex_exec'}, 'session_meta'),
            item(0, {'model': 'm-x', 'effort': 'low'}, 'turn_context'),
            message(0, '<environment_context>ak-demo-skill listed here</environment_context>'),
            tokens(1, 100, 50, 10),
            message(2, 'use $ak-demo-skill audit now'),
            item(3, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c1',
                     'arguments': json.dumps({'cmd': 'cat ~/.agents/skills/ak-demo-skill/SKILL.md'})}),
            item(4, {'type': 'function_call_output', 'call_id': 'c1', 'output': 'Exit code: 0'}),
            item(5, {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'c2',
                     'input': 'read("D:\\\\k\\\\ak-demo-skill\\\\references\\\\guide.md\\n")'}),
            item(9, {'type': 'custom_tool_call_output', 'call_id': 'c2', 'output': [{'type': 'input_text', 'text': 'Script error:\nExit code: 2'}]}),
            tokens(10, 300, 150, 40, 5),
            message(11, 'next task'),
            tokens(12, 900, 150, 90),
        ])
        records = list(session_usage.codex_invocations(path, self.sid))
        self.assertEqual(len(records), 1)
        r = records[0]
        self.assertEqual((r['trigger'], r['subcommand'], r['entrypoint'], r['effort']), ('user', 'audit', 'codex_exec', 'low'))
        self.assertEqual(r['tokens'], {'input': 100, 'cache_read': 100, 'cache_write': 0, 'output': 30, 'reasoning': 5})
        self.assertEqual((r['tool_calls'], r['tool_errors'], r['errors_by_tool']), (2, 1, {'exec': 1}))
        self.assertEqual(r['skill_files'], {'SKILL.md': 1, 'references/guide.md': 1})
        self.assertEqual(r['models'], {'m-x': 2})
        self.assertEqual(r['turns'], 2)
        self.assertEqual(r['duration_s'], 7.0)

    def test_codex_ignores_injected_context_and_reads_current_exit_formats(self):
        path = self.root / 'codex' / 'rollout-2.jsonl'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}

        def message(second, text):
            return item(second, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}]})

        def call(second, call_id):
            return item(second, {'type': 'function_call', 'name': 'exec_command', 'call_id': call_id, 'arguments': '{}'})

        def output(second, call_id, text):
            return item(second, {'type': 'function_call_output', 'call_id': call_id, 'output': [{'type': 'input_text', 'text': text}]})

        write_jsonl(path, [
            message(0, '# AGENTS.md instructions for D:\\repo\n- debugging \u2192 /ak-demo-skill'),
            message(1, '$ak-demo-skill audit'),
            item(2, {'type': 'reasoning'}), call(2, 'a'), call(2, 'b'), call(2, 'c'), call(2, 'd'),
            output(3, 'a', 'Chunk ID: 1\nProcess exited with code 1\nOutput:'),
            output(3, 'b', '{"chunk_id":"x","exit_code":2,"output":""}'),
            output(3, 'c', 'Process exited with code 0\n' + 'x' * 400 + 'Exit code: 1 appears in file content'),
            output(3, 'd', 'Exit code: 0'),
            item(4, {'type': 'turn_aborted', 'reason': 'interrupted'}, 'event_msg'),
            item(5, {'type': 'message', 'role': 'assistant', 'content': []}),
        ])
        [r] = session_usage.codex_invocations(path, self.sid)
        self.assertEqual((r['trigger'], r['subcommand']), ('user', 'audit'))
        self.assertEqual((r['turns'], r['tool_calls'], r['tool_errors'], r['interruptions']), (2, 4, 2, 1))

    def test_slug_match_requires_a_boundary(self):
        other = session_usage.SkillId('debug')
        self.assertEqual(other.files_in('cat ~/.codex/skills/ak-debug/SKILL.md'), set())
        self.assertEqual(other.files_in('cat ~/.codex/skills/debug/SKILL.md'), {'SKILL.md'})
        self.assertEqual(self.sid.files_in('x/not-ak-demo-skill/references/a.md'), set())

    def test_codex_model_trigger_requires_skill_read(self):
        path = self.root / 'codex' / 'r.jsonl'
        write_jsonl(path, [
            {'timestamp': ts(0), 'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'a',
                                                                    'arguments': json.dumps({'cmd': 'ls ak-demo-skill/references'})}},
            {'timestamp': ts(1), 'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'shell', 'call_id': 'b',
                                                                    'arguments': json.dumps({'cmd': 'cat ak-demo-skill/SKILL.md'})}},
        ])
        records = list(session_usage.codex_invocations(path, self.sid))
        self.assertEqual([(r['trigger'], r['tool_calls']) for r in records], [('model', 1)])

    def test_archived_codex_copy_is_counted_once(self):
        events = [{'timestamp': ts(0), 'type': 'response_item', 'payload': {
            'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '$ak-demo-skill audit'}]}}]
        write_jsonl(self.root / 'sessions' / '2026' / 'rollout-x.jsonl', events)
        write_jsonl(self.root / 'archived' / 'rollout-x.jsonl', events)
        out = io.StringIO()
        with redirect_stdout(out):
            session_usage.main(['ak-demo-skill', '--root', f'codex={self.root / "sessions"}',
                                '--root', f'codex={self.root / "archived"}', '--summary-only'])
        payload = json.loads(out.getvalue())
        self.assertEqual((payload['transcripts_scanned'], payload['summary']['invocations']), (1, 1))

    def test_signals_flag_delegation_errors_and_unread_references(self):
        skill = self.root / 'ak-demo-skill'
        (skill / 'references').mkdir(parents=True)
        (skill / 'SKILL.md').write_text('---\nname: ak:demo-skill\n---\n', encoding='utf-8')
        for name in ('used.md', 'unused.md'):
            (skill / 'references' / name).write_text('x', encoding='utf-8')
        sid = session_usage.SkillId(str(skill))
        records = []
        for _ in range(5):
            record = session_usage.new_record('claude-code', 'abc', 'user', 'audit')
            record['tool_calls'], record['tools'] = 20, session_usage.Counter({'Read': 18, 'Bash': 2})
            record['errors_by_tool'], record['tool_errors'] = session_usage.Counter({'Bash': 1}), 1
            record['tokens']['output'] = 1000
            record['skill_files'] = session_usage.Counter({'references/used.md': 1})
            records.append(session_usage.finish(record, None, None))
        summary = session_usage.aggregate(records, sid)
        ids = {s['id'] for s in summary['signals']}
        self.assertEqual(summary['unused_skill_files'], ['references/unused.md'])
        self.assertTrue({'delegation-candidate', 'tool-error-rate', 'reference-never-loaded', 'reference-always-loaded'} <= ids, ids)

    def test_clean_rel_drops_escape_residue(self):
        self.assertEqual(session_usage.clean_rel('references/a.md/ngit'), 'references/a.md')
        self.assertEqual(session_usage.clean_rel('scripts\\tests\\n'), 'scripts/tests')
        self.assertEqual(session_usage.subcommand('cải thiện', {'audit'}), '(free-text)')
        self.assertEqual(session_usage.subcommand('Johnny please', {'audit'}), '(free-text)')
        self.assertEqual(session_usage.subcommand('Audit x', {'audit'}), 'audit')
        self.assertIsNone(session_usage.subcommand('  ', {'audit'}))
        self.assertEqual(self.sid.modes, {'audit', 'optimize'})

    def test_main_filters_sessions_and_reports_no_match(self):
        self.claude_fixture()
        root = f'claude-code={self.root / "claude"}'
        out = io.StringIO()
        with redirect_stdout(out):
            code = session_usage.main(['ak-demo-skill', '--root', root, '--summary-only'])
        payload = json.loads(out.getvalue())
        self.assertEqual((code, payload['summary']['invocations']), (0, 1))
        self.assertNotIn('invocations', payload)
        self.assertNotIn('thanks', out.getvalue())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(session_usage.main(['ak-demo-skill', '--root', root, '--exclude-session', 'sess-claude-1']), 1)
            self.assertEqual(session_usage.main(['ak-demo-skill', '--root', root, '--entrypoint', 'codex_exec']), 1)

    def test_session_inventory_lists_every_skill_with_trigger_and_files(self):
        path = self.root / 'claude' / 'proj' / 'sess-claude-1.jsonl'
        other = {'file_path': '/home/u/.claude/skills/ak-other/references/a.md'}
        write_jsonl(path, [
            user(0, '<command-name>/ak:demo-skill</command-name>\n<command-args>audit</command-args>'),
            user(0, [{'type': 'text', 'text': 'Base directory for this skill: /home/u/.claude/skills/ak-demo-skill'}], isMeta=True),
            assistant(1, 'm1', [tool_use('t1', 'Read', other)]),
            user(2, result('t1')),
            assistant(3, 'm2', [tool_use('t2', 'Skill', {'skill': 'plugin:ak-third'}), tool_use('t3', 'Read', other)]),
            user(4, result('t2') + result('t3', is_error=True)),
            user(5, 'This session is being continued from a previous conversation.', isCompactSummary=True),
            user(6, [{'type': 'text', 'text': '[Request interrupted by user]'}]),
        ])
        inv = session_usage.session_inventory('claude-code', path)
        by_name = {s['skill']: s for s in inv['skills']}
        self.assertEqual([s['skill'] for s in inv['skills']], ['ak-demo-skill', 'ak-other', 'ak-third'])
        self.assertEqual((by_name['ak-demo-skill']['triggers'], by_name['ak-demo-skill']['files']), ({'user': 1}, {'SKILL.md': 1}))
        self.assertEqual((by_name['ak-other']['invoked'], by_name['ak-other']['files']), (False, {'references/a.md': 2}))
        self.assertEqual(by_name['ak-third']['triggers'], {'model': 1})
        self.assertEqual((inv['tool_calls'], inv['tool_errors'], inv['duplicate_calls']), (3, 1, 1))
        self.assertEqual(inv['errors_by_tool'], {'Read': 1})
        self.assertEqual((inv['turns'], inv['compactions'], inv['interruptions']), (2, 1, 1))
        self.assertEqual(inv['session'], 'sess-cla')

    def test_codex_session_inventory_counts_mentions_and_skill_reads(self):
        path = self.root / 'codex' / 'rollout-9.jsonl'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}

        write_jsonl(path, [
            item(0, {'id': 'codex-session-9', 'cwd': str(self.root)}, 'session_meta'),
            item(1, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'use $ak-demo-skill now, not $MY_PRIVATE_codename or $500'}]}),
            item(2, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c0',
                     'arguments': json.dumps({'cmd': 'cat ~/.agents/skills/ak-demo-skill/SKILL.md'})}),
            item(3, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c1',
                     'arguments': json.dumps({'cmd': 'cat ~/.agents/skills/ak-two/SKILL.md'})}),
            item(4, {'type': 'function_call_output', 'call_id': 'c1', 'output': 'Exit code: 1'}),
        ])
        inv = session_usage.session_inventory('codex', path)
        self.assertEqual([(s['skill'], s['triggers']) for s in inv['skills']],
                         [('ak-demo-skill', {'user': 1}), ('ak-two', {'model': 1})])
        self.assertNotIn('MY_PRIVATE_codename', json.dumps(inv))
        self.assertEqual((inv['session'], inv['human_prompts'], inv['tool_errors']), ('codex-se', 1, 1))

    def omp_fixture(self):
        """omp transcript: user-run ak-demo-skill, a model skill:// load of ak-two, a failed read, an abort, a compaction and a subagent file."""
        root = self.root / 'omp'
        path = root / '-repo' / '2026-09-01T10-00-00-000Z_omp-sess-1.jsonl'

        def msg(second, message):
            return {'type': 'message', 'id': f'e{second}', 'timestamp': ts(second), 'message': message}

        def call(call_id, name, args):
            return {'type': 'toolCall', 'id': call_id, 'name': name, 'arguments': args}

        usage = {'input': 1, 'output': 20, 'cacheRead': 100, 'cacheWrite': 5}
        write_jsonl(path, [
            {'type': 'session', 'id': 'omp-sess-1', 'cwd': str(self.root / 'repo'), 'timestamp': ts(0), 'version': 3},
            {'type': 'custom_message', 'customType': 'skill-prompt', 'timestamp': ts(1),
             'details': {'name': 'ak-demo-skill', 'path': '/home/u/.omp/agent/skills/ak-demo-skill/SKILL.md', 'args': 'audit it'}},
            msg(2, {'role': 'assistant', 'responseId': 'r1', 'model': 'm', 'usage': usage, 'stopReason': 'toolUse', 'content': [
                call('c1', 'read', {'path': 'skill://ak-two'}), call('c2', 'read', {'path': 'skill://ak-demo-skill/references/guide.md'})]}),
            msg(3, {'role': 'toolResult', 'toolCallId': 'c1', 'toolName': 'read', 'isError': False, 'content': []}),
            msg(4, {'role': 'toolResult', 'toolCallId': 'c2', 'toolName': 'read', 'isError': True, 'content': []}),
            msg(5, {'role': 'assistant', 'responseId': 'r2', 'model': 'm', 'usage': usage, 'stopReason': 'aborted', 'content': []}),
            {'type': 'compaction', 'id': 'e6', 'timestamp': ts(6)},
            msg(7, {'role': 'user', 'attribution': 'user', 'content': [{'type': 'text', 'text': 'next request'}]}),
        ])
        write_jsonl(path.with_suffix('') / 'Scout.jsonl', [{'type': 'session', 'id': 'sub', 'cwd': str(self.root / 'repo')}])
        return root, path

    def test_omp_session_inventory_and_invocations(self):
        root, path = self.omp_fixture()
        self.assertEqual(session_usage.find_session({'omp': [root]}, 'latest', self.root / 'repo'), ('omp', path))
        self.assertEqual(list(session_usage.transcripts({'omp': [root]}, None)), [('omp', path)])  # subagent file skipped
        self.assertEqual(session_usage.runtime_of(path), 'omp')
        newer_claude = self.root / 'claude' / re.sub(r'[^A-Za-z0-9]', '-', str(self.root / 'repo')) / 'later.jsonl'
        write_jsonl(newer_claude, [user(9, 'hi')])
        both = {'omp': [root], 'claude-code': [self.root / 'claude']}
        self.assertEqual(session_usage.find_session(both, 'latest', self.root / 'repo')[0], 'claude-code')
        with mock.patch.dict(os.environ, {'PI_SESSION_FILE': str(path)}):
            self.assertEqual(session_usage.find_session(both, 'latest', self.root / 'repo'), ('omp', path))
        inv = session_usage.session_inventory('omp', path)
        by_name = {s['skill']: s for s in inv['skills']}
        self.assertEqual((by_name['ak-demo-skill']['triggers'], by_name['ak-demo-skill']['files']),
                         ({'user': 1}, {'SKILL.md': 1, 'references/guide.md': 1}))
        self.assertEqual(by_name['ak-two']['triggers'], {'model': 1})
        self.assertEqual((inv['session'], inv['human_prompts'], inv['turns']), ('omp-sess', 2, 2))
        self.assertEqual((inv['tool_errors'], inv['interruptions'], inv['compactions']), (1, 1, 1))
        [record] = session_usage.omp_invocations(path, self.sid)
        self.assertEqual((record['runtime'], record['trigger'], record['subcommand']), ('omp', 'user', 'audit'))
        self.assertEqual((record['tool_errors'], record['interruptions'], record['skill_files']), (1, 1, {'references/guide.md': 1}))

    def test_omp_all_lists_omp_sessions_without_message_text(self):
        root, path = self.omp_fixture()
        out = io.StringIO()
        with redirect_stdout(out):
            code = session_usage.main(['--all', '--runtime', 'omp', '--root', f'omp={root}', '--jobs', '1'])
        self.assertEqual(code, 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report['transcripts_scanned'], 1)
        self.assertEqual(sorted(s['skill'] for s in report['skills']), ['ak-demo-skill', 'ak-two'])
        self.assertNotIn('next request', out.getvalue())
        self.assertNotIn('audit it', out.getvalue())

    def test_omp_assistant_attributed_user_message_is_not_a_human_prompt(self):
        root, path = self.omp_fixture()
        events = session_usage.load_jsonl(path)
        events.append({'type': 'message', 'id': 'e8', 'timestamp': ts(8),
                       'message': {'role': 'user', 'attribution': 'agent', 'content': [{'type': 'text', 'text': 'x'}]}})
        write_jsonl(path, events)
        self.assertEqual(session_usage.session_inventory('omp', path)['human_prompts'], 2)

    def test_latest_session_falls_back_to_the_nearest_project_ancestor(self):
        project = self.root / 'repo'
        sub = project / 'kits' / 'core'
        sub.mkdir(parents=True)
        path = self.root / 'claude' / re.sub(r'[^A-Za-z0-9]', '-', str(project)) / 's1.jsonl'
        write_jsonl(path, [user(0, 'hi')])
        roots = {'claude-code': [self.root / 'claude']}
        self.assertEqual(session_usage.find_session(roots, 'latest', sub), ('claude-code', path))
        self.assertIsNone(session_usage.find_session(roots, 'latest', self.root / 'elsewhere'))

    def test_main_session_resolves_path_or_id_and_rejects_ambiguous_input(self):
        path = self.claude_fixture()
        root = f'claude-code={self.root / "claude"}'
        for selector in (str(path), 'sess-claude-1'):
            out = io.StringIO()
            with redirect_stdout(out):
                self.assertEqual(session_usage.main(['--session', selector, '--root', root]), 0)
            self.assertEqual(json.loads(out.getvalue())['skills'][0]['skill'], 'ak-demo-skill')
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(session_usage.main(['--session', 'missing', '--root', root]), 1)
            for argv in (['ak-demo-skill', '--session', 'latest'], []):
                with self.assertRaises(SystemExit):
                    session_usage.main(argv)

    def test_all_sessions_rank_skills_and_keep_troubled_sessions_as_leads(self):
        claude = self.root / 'claude'
        write_jsonl(claude / 'p1' / 'a.jsonl', [
            user(0, '<command-name>/ak-demo-skill</command-name>'),
            user(0, [{'type': 'text', 'text': 'Base directory for this skill: /home/u/.claude/skills/ak-demo-skill'}], isMeta=True),
            assistant(1, 'm1', [tool_use('t1', 'Bash', {'command': 'x'}), tool_use('t2', 'Bash', {'command': 'x'})]),
            user(2, result('t1', is_error=True) + result('t2', is_error=True)),
        ])
        write_jsonl(claude / 'p2' / 'b.jsonl', [
            {**user(0, '<command-name>/ak-demo-skill</command-name>'), 'sessionId': 'sess-b'},
            {**user(0, [{'type': 'text', 'text': 'Base directory for this skill: /home/u/.claude/skills/ak-demo-skill'}], isMeta=True), 'sessionId': 'sess-b'},
            {**user(0, '<command-name>/compact</command-name>'), 'sessionId': 'sess-b'},
            {**assistant(1, 'm1', [tool_use('t1', 'Skill', {'skill': 'ak:other'})]), 'sessionId': 'sess-b'},
        ])
        write_jsonl(claude / 'p3' / 'plain.jsonl', [{**user(0, 'no skill here'), 'sessionId': 'sess-plain'}])
        write_jsonl(claude / 'p4' / 'current.jsonl', [{**assistant(0, 'm1', [tool_use('t1', 'Skill', {'skill': 'ak-third'})]), 'sessionId': 'current-1'}])
        out = io.StringIO()
        with redirect_stdout(out):
            code = session_usage.main(['--all', '--root', f'claude-code={claude}', '--jobs', '1', '--exclude-session', 'current-1'])
        report = json.loads(out.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual((report['transcripts_scanned'], report['sessions_with_skills']), (4, 2))
        by_name = {s['skill']: s for s in report['skills']}
        self.assertEqual([s['skill'] for s in report['skills']], ['ak-demo-skill', 'ak-other'])
        demo = by_name['ak-demo-skill']
        self.assertEqual((demo['sessions'], demo['sessions_with_errors'], demo['tool_errors'], demo['duplicate_calls']), (2, 1, 2, 1))
        self.assertEqual(demo['errors_by_tool'], {'Bash': 2})
        self.assertEqual([(lead['session'], lead['score']) for lead in demo['leads']], [('sess-cla', 3)])
        self.assertEqual(by_name['ak-other']['triggers'], {'model': 1})
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                session_usage.main(['--all', '--session', 'latest'])

    def run_all(self, *roots):
        out = io.StringIO()
        with redirect_stdout(out):
            session_usage.main(['--all', '--jobs', '1', *[arg for root in roots for arg in ('--root', root)]])
        return {s['skill']: s for s in json.loads(out.getvalue())['skills']}, json.loads(out.getvalue())

    def test_all_charges_trouble_only_to_the_skill_whose_span_holds_it(self):
        claude = self.root / 'claude'
        base = 'Base directory for this skill: /home/u/.claude/skills/{}'
        write_jsonl(claude / 'p' / 'chain.jsonl', [
            user(0, '<command-name>/ak-first</command-name>'),
            user(0, [{'type': 'text', 'text': base.format('ak-first')}], isMeta=True),
            assistant(1, 'm1', [tool_use('t1', 'Read', {'file_path': 'a'})]),
            user(2, result('t1')),
            user(3, 'now the next request'),
            user(4, '<command-name>/ak-second</command-name>'),
            user(4, [{'type': 'text', 'text': base.format('ak-second')}], isMeta=True),
            assistant(5, 'm2', [tool_use('t2', 'Bash', {'command': 'x'}), tool_use('t3', 'Bash', {'command': 'x'})]),
            user(6, result('t2', is_error=True) + result('t3', is_error=True)),
            user(7, [{'type': 'text', 'text': '[Request interrupted by user]'}]),
        ])
        by_name, _ = self.run_all(f'claude-code={claude}')
        first, second = by_name['ak-first'], by_name['ak-second']
        self.assertEqual((first['tool_errors'], first['duplicate_calls'], first['interrupted_sessions'], first['leads']),
                         (0, 0, 0, []))
        self.assertEqual(first['session_totals'], {'tool_errors': 2, 'duplicate_calls': 1, 'interruptions': 1})
        self.assertEqual((second['tool_errors'], second['duplicate_calls'], second['interrupted_sessions']), (2, 1, 1))
        self.assertEqual([(lead['score'], lead['session_score']) for lead in second['leads']], [(6, 6)])

    def test_all_counts_a_forked_codex_session_once(self):
        codex = self.root / 'codex'

        def item(second, payload, kind='response_item'):
            return {'timestamp': ts(second), 'type': kind, 'payload': payload}
        history = [
            item(1, {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'run $ak-demo-skill'}]}),
            item(2, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c0',
                     'arguments': json.dumps({'cmd': 'cat ~/.agents/skills/ak-demo-skill/SKILL.md'})}),
            item(3, {'type': 'function_call_output', 'call_id': 'c0', 'output': 'Exit code: 1'}),
        ]
        parent_meta = item(0, {'id': 'parent-0001', 'cwd': str(self.root)}, 'session_meta')
        write_jsonl(codex / 'rollout-parent.jsonl', [parent_meta, *history])
        # Fork marked with forked_from_id; it replays the parent's history and adds a second failure.
        extra = [item(4, {'type': 'function_call', 'name': 'exec_command', 'call_id': 'c1', 'arguments': '{"cmd":"y"}'}),
                 item(5, {'type': 'function_call_output', 'call_id': 'c1', 'output': 'Exit code: 2'})]
        write_jsonl(codex / 'rollout-fork.jsonl', [item(0, {'id': 'fork-0002', 'forked_from_id': 'parent-0001'}, 'session_meta'),
                                                   *history, *extra])
        # Older fork format: no forked_from_id, but the parent's session_meta is replayed after its own; fork of the fork.
        write_jsonl(codex / 'rollout-fork2.jsonl', [item(0, {'id': 'fork-0003'}, 'session_meta'),
                                                    item(0, {'id': 'fork-0002'}, 'session_meta'), *history, *extra])
        # A sibling fork of the parent does its own work, so it is a session of its own.
        write_jsonl(codex / 'rollout-sibling.jsonl', [item(0, {'id': 'sibl-0005', 'forked_from_id': 'parent-0001'}, 'session_meta'),
                                                      *history])
        # A subagent names its parent thread but does its own work, so it stays a separate session.
        write_jsonl(codex / 'rollout-sub.jsonl', [item(0, {'id': 'sub-0004', 'parent_thread_id': 'parent-0001'}, 'session_meta'),
                                                  *history])
        by_name, report = self.run_all(f'codex={codex}')
        demo = by_name['ak-demo-skill']
        self.assertEqual((report['sessions_with_skills'], demo['sessions'], demo['tool_errors']), (3, 3, 4))
        self.assertEqual(sorted(lead['session'] for lead in demo['leads']), ['fork-000', 'sibl-000', 'sub-0004'])
        self.assertEqual(session_usage.session_inventory('codex', codex / 'rollout-fork2.jsonl')['forked_from'], 'fork-0002')


if __name__ == '__main__':
    unittest.main()
