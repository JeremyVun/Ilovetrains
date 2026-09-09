#!/usr/bin/env ruby
# Regenerate the checked-in Xcode project after adding source files. Requires the xcodeproj gem.
require 'xcodeproj'
require 'fileutils'
root = File.expand_path('..', __dir__)
ios = File.join(root, 'ios')
project_path = File.join(ios, 'ILoveTrains.xcodeproj')
project = Xcodeproj::Project.new(project_path)
app = project.new_target(:application, 'ILoveTrains', :ios, '17.0')
widget = project.new_target(:app_extension, 'TravelTrackerWidget', :ios, '17.0')
tests = project.new_target(:unit_test_bundle, 'ILoveTrainsTests', :ios, '17.0')
ui_tests = project.new_target(:ui_test_bundle, 'ILoveTrainsUITests', :ios, '17.0')
tests.add_dependency(app)
ui_tests.add_dependency(app)
app.add_dependency(widget)
version = File.read(File.join(root, 'web/js/version.js'))[/VERSION = '([^']+)'/, 1]
[app, widget, tests, ui_tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings.merge!({
      'SWIFT_VERSION' => '5.0', 'IPHONEOS_DEPLOYMENT_TARGET' => '17.0',
      'TARGETED_DEVICE_FAMILY' => '1,2', 'CODE_SIGN_STYLE' => 'Automatic',
      'DEVELOPMENT_TEAM' => '8QYAPRZLHG', 'MARKETING_VERSION' => version,
      'CURRENT_PROJECT_VERSION' => '6', 'ENABLE_USER_SCRIPT_SANDBOXING' => 'YES',
      'SWIFT_EMIT_LOC_STRINGS' => 'YES'
    })
    config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG' if config.name == 'Debug'
  end
end
widget.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.ilovetrains.ios.TravelTrackerWidget',
    'INFOPLIST_FILE' => 'TravelTrackerWidget/Info.plist',
    'GENERATE_INFOPLIST_FILE' => 'NO', 'APPLICATION_EXTENSION_API_ONLY' => 'YES',
    'SKIP_INSTALL' => 'YES'
  })
end
app.build_configurations.each do |config|
  config.build_settings['EXCLUDED_SOURCE_FILE_NAMES'] = 'calibration.json' if config.name == 'Release'
  config.build_settings.merge!({ 'PRODUCT_BUNDLE_IDENTIFIER' => 'com.ilovetrains.ios',
    'INFOPLIST_FILE' => 'ILoveTrains/Info.plist', 'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'GENERATE_INFOPLIST_FILE' => 'NO', 'OTHER_LDFLAGS' => ['$(inherited)', '-lsqlite3', '-lz'] })
end
[[tests, 'com.ilovetrains.ios.tests'], [ui_tests, 'com.ilovetrains.ios.uitests']].each do |target, bundle|
  target.build_configurations.each do |config|
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle
    config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
    config.build_settings['TEST_TARGET_NAME'] = 'ILoveTrains'
    if target == tests
      config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/ILoveTrains.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/ILoveTrains'
      config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
    end
  end
end
[[app, 'ILoveTrains'], [widget, 'TravelTrackerWidget'], [tests, 'ILoveTrainsTests'], [ui_tests, 'ILoveTrainsUITests']].each do |target, dir|
  group = project.main_group.new_group(dir, dir)
  Dir.glob(File.join(ios, dir, '**', '*.{swift,c,m}')).sort.each do |path|
    ref = group.new_file(path.delete_prefix(File.join(ios, dir) + '/'))
    target.source_build_phase.add_file_reference(ref)
  end
end
shared = project.main_group.new_group('Shared', 'Shared')
Dir.glob(File.join(ios, 'Shared', '*.swift')).sort.each do |path|
  ref = shared.new_file(File.basename(path))
  [app, widget].each { |target| target.source_build_phase.add_file_reference(ref) }
end
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(widget.product_reference).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
resources = project.main_group.new_group('Resources', 'ILoveTrains/Resources')
Dir.glob(File.join(ios, 'ILoveTrains/Resources', '*')).sort.each do |path|
  ref = resources.new_file(File.basename(path))
  app.resources_build_phase.add_file_reference(ref)
end
fixtures = project.main_group.new_group('Conformance', '../tools/fixtures/conformance')
%w[calibration.json prediction.json rows.json travel-tracker.json commute-feedback.json].each do |name|
  ref = fixtures.new_file(name)
  tests.resources_build_phase.add_file_reference(ref)
  app.resources_build_phase.add_file_reference(ref) if name == 'calibration.json'
end
2.times { project.predictabilize_uuids }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.add_test_target(ui_tests)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'ILoveTrains', true)
puts project_path
