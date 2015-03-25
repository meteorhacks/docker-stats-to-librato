var env = require('envalid');
var os = require('os');
var procfs = require('procfs-stats');
var librato = require('librato-node');

env.validate(process.env, {
  PREFIX: {required: true},
  INTERVAL: {required: true, parse: env.toNumber},
  LIBRATO_EMAIL: {required: true},
  LIBRATO_TOKEN: {required: true},
  PROC_PATH: {required: true},
});

// mount docker parents /proc somewhere
procfs.PROC = env.get('PROC_PATH');

var prefix = env.get('PREFIX');
var interval = env.get('INTERVAL');

// previous values
var prev = null;

librato.configure({
  email: env.get('LIBRATO_EMAIL'),
  token: env.get('LIBRATO_TOKEN'),
  period: interval,
});

// start librato
librato.start();

// stop librato on SIGINT
process.once('SIGINT', function() {
  librato.stop();
});

// catch error events
librato.on('error', function (e) {
  console.error(e);
});

// start sending metrics
updateMetrics();

function updateMetrics () {
  setTimeout(updateMetrics, interval);

  procfs.cpu(function (err, cpustats) {
    if(err) {
      return console.error(err);
    }

    procfs.net(function (err, netstats) {
      if(err) {
        return console.error(err);
      }

      var curr = {
        _time: Date.now(),
        cpustats: cpustats,
        netstats: netstats,
      };

      if(prev) {
        librato.measure(prefix + '-pcpu', getPcpu(curr));
        librato.measure(prefix + '-memory', getMemory(curr));
        librato.measure(prefix + '-netbw', getNetBw(curr));
      }

      prev = curr;
    });
  });
}

function getPcpu (curr) {
  var cStats = curr.cpustats.cpu;
  var pStats = prev.cpustats.cpu;

  var cTotal = 0;
  for(var k in cStats) {
    cTotal += parseInt(cStats[k]);
  }

  if(pStats._pTotal) {
    pTotal = pStats._pTotal
  } else {
    var pTotal = 0;
    for(var k in pStats) {
      pTotal += parseInt(pStats[k]);
    }

    pStats._pTotal = pTotal;
  }

  var cIdle = cStats.idle;
  var pIdle = pStats.idle;

  return 100 * (1 - (cIdle - pIdle)/(cTotal - pTotal));
}

function getMemory (curr) {
  return os.totalmem() - os.freemem();
}

function getNetBw (curr) {
  var cStats = curr.netstats;
  var pStats = prev.netstats;

  var cBytes = 0;
  for(var i=0; i<cStats.length; ++i) {
    var bytes = cStats[i].bytes;
    cBytes += bytes.Receive + bytes.Transmit;
  }

  if(pStats._pBytes) {
    var pBytes = pStats._pBytes;
  } else {
    var pBytes = 0;
    for(var i=0; i<pStats.length; ++i) {
      var bytes = pStats[i].bytes;
      pBytes += bytes.Receive + bytes.Transmit;
    }

    pStats._pBytes = pBytes;
  }

  var time = (curr._time - prev._time)/1000;
  return (cBytes - pBytes)/time;
}
