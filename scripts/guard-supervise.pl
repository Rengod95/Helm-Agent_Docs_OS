#!/usr/bin/perl
# scripts/guard-supervise.pl: the guard's path without systemd (macOS, CI, containers): one process group, a time limit, and the
# whole group ends with the command. perl is part of macOS and every Linux base image, so this adds no dependency.
# usage: guard-supervise.pl <timeout_sec> <grace_sec> -- <command...>
#   timeout_sec  seconds the command may run, 0 for no limit
#   grace_sec    seconds between SIGTERM and SIGKILL when the group is ended
# The command runs in its own process group (and owns the terminal while it runs, so a test that reads stdin still works).
# The group, plus every descendant that left it (setsid) while its parent is still alive, is ended when:
#   - the command exits (a test runner's leftover children, e.g. a `log stream` monitor, end with it),
#   - the time limit passes (exit 124),
#   - this process gets TERM, INT or HUP (exit 128+signal),
#   - the process that started this one is gone (reparented: exit 143). The check runs every 0.2s, so a caller that was
#     SIGKILLed cannot leave the group behind. Only this process being SIGKILLed itself is not covered: `just orphans` finds that.
# A descendant whose parent exited before the end (a double fork that daemonizes) is not found: macOS has no child subreaper,
# so the only link to it is its parent. It is not killed.
# exit: the command's exit code, 128+n when a signal ended it, 124 time limit, 143 caller gone, 127 command not found.
use strict;
use warnings;
use POSIX qw(WNOHANG);

my ($timeout, $grace) = (shift @ARGV, shift @ARGV);
shift @ARGV if @ARGV && $ARGV[0] eq '--';
die "usage: guard-supervise.pl <timeout_sec> <grace_sec> -- <command...>\n" unless defined $grace && @ARGV;

my $caller = getppid();
my $stop = '';
for my $name (qw(TERM INT HUP)) {
  $SIG{$name} = sub { $stop ||= $name };
}
my $tty = -t STDIN;
$SIG{TTOU} = 'IGNORE';

my $pid = fork();
die "guard-supervise: fork failed: $!\n" unless defined $pid;
if ($pid == 0) {
  setpgrp(0, 0);
  { no warnings 'exec'; exec { $ARGV[0] } @ARGV; }
  print STDERR "guard-supervise: cannot run $ARGV[0]: $!\n";
  POSIX::_exit(127);
}
setpgrp($pid, $pid);
my $home_pgrp = getpgrp();
POSIX::tcsetpgrp(0, $pid) if $tty;

# pids of everything below $root, by parent links (a process that left the group is still found)
sub descendants {
  my ($root) = @_;
  my %kids;
  open(my $ps, '-|', 'ps', '-axo', 'pid=,ppid=') or return ();
  while (<$ps>) {
    push @{ $kids{$2} }, $1 if /^\s*(\d+)\s+(\d+)/;
  }
  close $ps;
  my @out;
  my @todo = ($root);
  while (@todo) {
    my $p = shift @todo;
    for my $c (@{ $kids{$p} || [] }) {
      push @out, $c;
      push @todo, $c;
    }
  }
  return @out;
}

sub group_alive {
  return kill(0, -$pid) ? 1 : 0;
}

# TERM the group and the descendants, wait up to $grace seconds, then KILL what is left
sub end_all {
  my @desc = descendants($pid);
  kill 'TERM', -$pid;
  kill 'TERM', @desc if @desc;
  my $until = time() + $grace;
  while (time() < $until && (group_alive() || grep { kill(0, $_) } @desc)) {
    select(undef, undef, undef, 0.1);
  }
  my @left = grep { kill(0, $_) } (@desc, descendants($pid));
  kill 'KILL', -$pid;
  kill 'KILL', @left if @left;
}

my $started = time();
my $status;
my $why = '';
while (1) {
  my $got = waitpid($pid, WNOHANG);
  if ($got == $pid) {
    $status = $?;
    last;
  }
  if ($stop) {
    $why = "signal $stop";
    last;
  }
  if ($timeout > 0 && time() - $started >= $timeout) {
    $why = 'timeout';
    last;
  }
  if (getppid() != $caller) {
    $why = 'caller gone';
    last;
  }
  select(undef, undef, undef, 0.2);
}

my $code;
if ($why ne '') {
  end_all();
  waitpid($pid, 0);
  my %sig = (TERM => 143, INT => 130, HUP => 129);
  if ($why eq 'timeout') {
    print STDERR "guard-supervise: time limit ${timeout}s passed, the process group ended (exit 124)\n";
    $code = 124;
  } elsif ($why eq 'caller gone') {
    print STDERR "guard-supervise: the caller is gone, the process group ended (exit 143)\n";
    $code = 143;
  } else {
    $code = $sig{$stop} || 143;
  }
} else {
  # the command is done: whatever it left in its group (a monitor, a worker) ends with it
  my @desc = group_alive() ? descendants($pid) : ();
  end_all() if group_alive() || @desc;
  $code = ($status & 127) ? 128 + ($status & 127) : $status >> 8;
}
POSIX::tcsetpgrp(0, $home_pgrp) if $tty;
exit $code;
