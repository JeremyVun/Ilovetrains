"""Exercise native command routing without compiling or starting devices."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class NativeCommandsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for directory in ('tools', 'android', 'bin', 'logs'):
            (self.root / directory).mkdir()
        for name in ('build-android.sh', 'build-ios.sh', 'check-log.sh', 'shoot-android.sh'):
            shutil.copy2(ROOT / 'tools' / name, self.root / 'tools' / name)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + os.pathsep + os.environ['PATH'],
                        TEST_LOG_DIR=str(self.root / 'logs'), TEST_VERBOSE='0',
                        ILOVETRAINS_SIMULATOR_ID='test-simulator',
                        CALLS=str(self.root / 'calls.json'))
        recorder = '''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['CALLS'], 'w') as f: json.dump(sys.argv[1:], f)
print('BUILD SUCCESSFUL')
sys.exit(int(os.environ.get('FAKE_EXIT', '0')))
'''
        for name in ('android/gradlew', 'bin/xcodebuild'):
            p = self.root / name
            p.write_text(recorder)
            p.chmod(0o755)
        p = self.root / 'bin/xcrun'
        p.write_text('#!/bin/sh\nexit 0\n')
        p.chmod(0o755)

    def command(self, script, *args):
        return subprocess.run(['/bin/bash', str(self.root / 'tools' / script), *args],
                              cwd=self.root, env=self.env, text=True, capture_output=True)

    def calls(self):
        return json.loads((self.root / 'calls.json').read_text())

    def test_android_unit_does_not_assemble_or_lint_and_preserves_patterns(self):
        result = self.command('build-android.sh', '--unit', '*PredictionTest', '*StorageTest')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [':app:testDebugUnitTest', '--tests', '*PredictionTest',
                                      '--tests', '*StorageTest', '--console=plain'])

    def test_android_default_preserves_full_gate(self):
        result = self.command('build-android.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [':app:assembleDebug', ':app:testDebugUnitTest', ':app:lintDebug', '--console=plain'])

    def test_android_unit_without_filter_works_in_macos_bash(self):
        self.assertEqual(self.command('build-android.sh', '--unit').returncode, 0)
        self.assertNotIn('--tests', self.calls())

    def test_ios_unit_and_ui_select_only_the_requested_target(self):
        for mode, target in [('--unit', 'ILoveTrainsTests'), ('--ui', 'ILoveTrainsUITests')]:
            with self.subTest(mode=mode):
                result = self.command('build-ios.sh', mode)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual([x for x in self.calls() if x.startswith('-only-testing:')], [f'-only-testing:{target}'])

    def test_ios_method_filters_are_combined_in_one_invocation(self):
        result = self.command('build-ios.sh', '--unit', 'StorageTests/testRead', 'PredictionTests')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([x for x in self.calls() if x.startswith('-only-testing:')],
                         ['-only-testing:ILoveTrainsTests/StorageTests/testRead', '-only-testing:ILoveTrainsTests/PredictionTests'])

    def test_ios_full_gate_keeps_both_targets(self):
        result = self.command('build-ios.sh', '--test')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('test', self.calls())
        self.assertFalse(any(x.startswith('-only-testing:') for x in self.calls()))

    def test_failure_is_not_hidden_by_logging(self):
        self.env['FAKE_EXIT'] = '65'
        result = self.command('build-ios.sh', '--unit')
        self.assertEqual(result.returncode, 65)
        self.assertIn('FAILED', result.stderr)
        self.assertEqual(len(list((self.root / 'logs').iterdir())), 2)

    def test_unknown_modes_and_option_injection_fail_before_building(self):
        for script, args in [('build-android.sh', ['--typo']),
                             ('build-android.sh', ['--unit', '--rerun-tasks']),
                             ('build-ios.sh', ['--unit', '-skip-testing:ILoveTrainsTests'])]:
            with self.subTest(script=script, args=args):
                self.assertEqual(self.command(script, *args).returncode, 2)
                self.assertFalse((self.root / 'calls.json').exists())

    def test_android_capture_rejects_a_zero_exit_junit_failure(self):
        sdk = self.root / 'sdk' / 'platform-tools'
        sdk.mkdir(parents=True)
        adb = sdk / 'adb'
        adb.write_text('''#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
if a == ['get-state']: print('device')
elif a == ['shell', 'wm', 'size']: print('Physical size: 1080x2400')
elif a == ['shell', 'wm', 'density']: print('Physical density: 420')
elif a == ['shell', 'settings', 'get', 'system', 'font_scale']: print('1.0')
elif a[:3] == ['shell', 'am', 'instrument']:
    with open(os.environ['CALLS'], 'w') as f: json.dump(a, f)
    print('FAILURES!!!\\nTests run: 1,  Failures: 1')
elif a and a[0] == 'pull':
    raise SystemExit('must not pull captures from a failed test')
''')
        adb.chmod(0o755)
        self.env.update(ANDROID_HOME=str(sdk.parent), OUT=str(self.root / 'captures'),
                        CALIBRATION_SCREENS='board,detail')
        result = self.command('shoot-android.sh', '390x844')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('Android calibration failed', result.stderr)
        self.assertIn('calibrationScreens', self.calls())
        self.assertIn('board,detail', self.calls())
        self.assertIn('com.ilovetrains.app.UiCalibrationTest#captureCanonicalScreens', self.calls())


if __name__ == '__main__':
    unittest.main()
