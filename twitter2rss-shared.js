const async = require("async"),
      dns = require('dns'),
      fs = require("fs-extra"),
      path = require("path"),
      // https://github.com/mapbox/node-sqlite3
      sqlite3 = require('sqlite3').verbose(),
      // https://github.com/winstonjs/winston
      winston = require("winston"),
      _ = require("underscore");

module.exports = function () {

    var parameters,
        configuration,
        logger;

    const init = function (_parameters, callback) {
        parameters = _parameters;
        async.series([

            // logger initialisation
            function (callback) {

                const dateToCSVDate = function (d) {
                    return d.getFullYear() + "-" +
                        ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
                        ("0" + d.getDate()).slice(-2) + " " +
                        ("0" + d.getHours()).slice(-2) + ":" +
                        ("0" + d.getMinutes()).slice(-2) + ":" +
                        ("0" + d.getSeconds()).slice(-2);
                }

                logger = new winston.Logger({
                    "level": _.contains([ "error", "warn", "info", "verbose", "debug", "silly" ], parameters.loglevel.toLowerCase()) ? parameters.loglevel.toLowerCase() : "error",
                    "transports": [
                        new (winston.transports.Console)({
                            "timestamp": () => dateToCSVDate(new Date()),
                            "formatter": options => options.timestamp() + ' ' + options.level.toUpperCase() + ' ' +
                                                    (undefined !== options.message ? options.message : '') +
                                                    (options.meta && Object.keys(options.meta).length ? '\n\t' +
                                                     JSON.stringify(options.meta) : ''),
                        })
                    ]
                });
                logger.info("Initialisation starting...");
                callback(null);
            },

            // config folder
            function (callback) {
                CONFIG_PATH = path.join(process.env.HOME, ".config", "twitter2rss");
                fs.ensureDir(path.join(CONFIG_PATH, "feeds"), callback);
            },

            // data folder
            function (callback) {
                DATA_PATH = path.join(process.env.HOME, ".local", "twitter2rss");
                fs.ensureDir(path.join(DATA_PATH, "feeds"), callback);
            },

            // read general configuration file
            function (callback) {
                fs.readFile(path.join(CONFIG_PATH, 'config'), { 'encoding': 'utf8' }, function (err, text) {
                    if (err) return callback(err);
                    // TODO: we may be a bit more cautious in trusting the
                    // configuration JSON file here...
                    configuration = JSON.parse(text);
                    callback(null);
                });
            },

        ], function (err) {
            if (err) {
                logger.error("Initialisation failed: " + err.message);
                return process.exit(1);
            }
            logger.info("Initialisation completed.");
            callback(null);
        });
    }

    const getFeedConfiguration = function (filename, callback) {
        logger.info("Reading configuration file " + filename + "...");
        fs.readFile(filename, { 'encoding': 'utf8' }, function (err, text) {
            if (err) return callback(err);
            logger.info("Configuration file " + filename + " read successfully.");
            callback(null, _.extend({ "name": path.basename(filename, ".json") }, JSON.parse(text)));
        });
    }

    const getFeedConfigurations = function (callback) {

        const getConfigurationFiles = function (callback) {
            logger.info("Getting the names of all configuration files...");
            var configurationFiles;
            if (parameters.debug) {
                return callback(null, [ parameters.debug ]);
            } else {
                fs.readdir(path.join(CONFIG_PATH, "feeds"), function (err, entries) {
                    async.filter(entries, function (entry, callback) {
                        fs.lstat(path.join(CONFIG_PATH, "feeds", entry), function (err, stats) {
                            callback(null, entry.match(/\.json$/) && stats.isFile());
                        });
                    }, function (err, results) {
                        if (err) return callback(err);
                        configurationFiles = results.map(function (r) { return path.join(CONFIG_PATH, "feeds", r); });
                        callback(null, configurationFiles);
                    });
                });
            }
        }

        logger.info("Reading all configuration files...");
        getConfigurationFiles(function (err, entries) {
            if (err) return callback(err);
            if (entries.length === 0) {
                logger.error("No configuration files found.");
                return callback(new Error("No configuration files found."));
            }
            var configurations = { };
            async.each(entries, function (entry, callback) {
                getFeedConfiguration(entry, function (err, configuration) {
                    if (err) return callback(err);
                    configurations[path.basename(entry, ".json")] = configuration;
                    callback(null);
                });
            }, function (err) {
                logger.info("All configuration files read.");
                callback(err, configurations);
            });
        });
    }

    const isOnline = callback => {
        // solution offered by http://stackoverflow.com/a/35015482
        console.log("Am I here 1?");
        dns.lookupService('8.8.8.8', 53, (err, hostname, service) => {
            console.log("Am I here 2? " + err);
            callback(!err);
        });
    }

    return {
        "getDataPath": function () { return DATA_PATH; },
        "getConfiguration": function () { return configuration; },
        "getFeedConfiguration": getFeedConfiguration,
        "getFeedConfigurations": getFeedConfigurations,
        "init": init,
        "isOnline": isOnline,
        "getLogger": function () { return logger; }
    };
}
