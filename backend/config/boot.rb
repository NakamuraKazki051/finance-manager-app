ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
# Speed up boot time by caching expensive operations.
# On Windows, bootsnap's native extension cannot open files whose path has
# non-ASCII characters (e.g. OneDrive\デスクトップ), and every rails command
# fails with Errno::E-01. Boot without it there; it is only a speed-up.
require "bootsnap/setup" unless Gem.win_platform? && !__dir__.ascii_only?
