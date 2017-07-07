'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.configure = configure;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Utility class for fetching data based on configured sources.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module dendra-dataloader
 */

var NEVER_FETCHED = exports.NEVER_FETCHED = 8640000000000000;

var defaultInterval = 500;
var defaultMaxFetches = 200;
var nextId = 1; // Next identifier for each DataLoader instance

// Local logger that can be redirected
var logger = {};

function noLog() {}

function configure(options) {
  if ((typeof options === 'undefined' ? 'undefined' : _typeof(options)) !== 'object') return;
  if (typeof options.interval === 'number') defaultInterval = options.interval;
  if (typeof options.maxFetches === 'number') defaultMaxFetches = options.maxFetches;
  if (_typeof(options.logger) === 'object' || options.logger === false) {
    ['error', 'log', 'time', 'timeEnd', 'warn'].forEach(function (k) {
      logger[k] = options.logger && options.logger[k] || noLog;
    });
  }
}

// Initial configuration
configure({
  logger: false
});

/**
 * Get model property keys for a given sourceKey.
 */
function propKeys(sourceKey) {
  return {
    error: sourceKey + 'Error',
    fetchedAt: sourceKey + 'FetchedAt',
    loading: sourceKey + 'Loading',
    ready: sourceKey + 'Ready'
  };
}

var DataFetchTask = function () {
  function DataFetchTask(model, keys) {
    _classCallCheck(this, DataFetchTask);

    this.time = new Date().getTime();
    this.keys = keys;
    this.model = model;
  }

  _createClass(DataFetchTask, [{
    key: 'run',
    value: function run(source) {
      var _this = this;

      this.model[this.keys.fetchedAt] = this.time;

      return Promise.resolve(source.fetch(this.model)).then(function (res) {
        if (_this.model[_this.keys.fetchedAt] === _this.time) {
          return {
            preempted: false,
            result: res
          };
        }

        return {
          preempted: true
        };
      });
    }
  }]);

  return DataFetchTask;
}();

var DataLoader = exports.DataLoader = function () {
  function DataLoader(model, sources) {
    _classCallCheck(this, DataLoader);

    this.id = nextId++;
    this.interval = defaultInterval;
    this.maxFetches = defaultMaxFetches; // Approximate upper limit
    this.model = model;
    this.sources = sources;

    model.dataLoading = false;
  }

  /**
   * Clear state for all sources where the specified predicate is true.
   */


  _createClass(DataLoader, [{
    key: 'clear',
    value: function clear() {
      var _this2 = this;

      var pred = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

      var predFn = typeof pred === 'function' ? pred : function (sourceKey) {
        return pred === true || sourceKey === pred;
      };
      var sources = this.sources;
      var model = this.model;

      Object.keys(sources).filter(predFn).forEach(function (sourceKey) {
        var keys = propKeys(sourceKey);
        var source = sources[sourceKey];

        logger.log('DataLoader(' + _this2.id + ')#clear::sourceKey', sourceKey);

        model[keys.error] = null;
        model[keys.loading] = false;
        model[keys.ready] = false;
        model[keys.fetchedAt] = NEVER_FETCHED;

        // Invoke clear hook
        if (typeof source.clear === 'function') source.clear(model);
      });

      return this;
    }

    /**
     * Cancel loading immediately and clean up.
     */

  }, {
    key: 'destroy',
    value: function destroy() {
      logger.log('DataLoader(' + this.id + ')#destroy');

      this.destroyed = true;
      this.sources = null;
      this.model = null;
    }
  }, {
    key: '_workerGen',
    value: regeneratorRuntime.mark(function _workerGen(done) {
      var _this3 = this;

      var sources, model, count, total;
      return regeneratorRuntime.wrap(function _workerGen$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              this.isLoading = true;

              logger.log('DataLoader(' + this.id + ')#worker');

              sources = this.sources;
              model = this.model;
              count = 0;
              total = 0;

            case 6:
              _context.next = 8;
              return setTimeout(function () {
                _this3._worker.next();
              }, this.interval);

            case 8:

              Object.keys(sources).filter(function (sourceKey) {
                var keys = propKeys(sourceKey);
                var source = sources[sourceKey];

                if (model[keys.loading]) return false; // Already loading source?

                // Evaluate guard condition
                return typeof source.guard === 'function' ? !!source.guard(model) : true;
              }).map(function (sourceKey) {
                var keys = propKeys(sourceKey);
                var source = sources[sourceKey];

                count++;
                total++;

                logger.log('DataLoader(' + _this3.id + ')#worker:beforeFetch::sourceKey,count,total', sourceKey, count, total);

                model[keys.error] = null;
                model[keys.loading] = true;
                model[keys.ready] = false;

                // Optional beforeFetch hook
                if (typeof source.beforeFetch === 'function') source.beforeFetch(model);

                return new DataFetchTask(model, keys).run(source).then(function (state) {
                  logger.log('DataLoader(' + _this3.id + ')#worker:afterFetch::sourceKey,state', sourceKey, state);

                  model[keys.loading] = false;

                  if (_this3.destroyed || !state || state.preempted) return;

                  // Process results
                  var res = state.result;
                  if (typeof source.afterFetch === 'function') res = source.afterFetch(model, res);
                  if (!res) throw Error('Not found: ' + sourceKey);

                  // Assign targets
                  if (typeof source.assign === 'function') source.assign(model, res);

                  model[keys.ready] = true;
                }).catch(function (err) {
                  logger.error('DataLoader(' + _this3.id + ')#worker:catch::sourceKey,err', sourceKey, err);

                  if (_this3.destroyed) return;

                  model[keys.loading] = false;
                  model[keys.error] = err.message;
                }).then(function () {
                  count--;
                });
              });

              // Safety net

              if (!(total > this.maxFetches)) {
                _context.next = 12;
                break;
              }

              logger.warn('DataLoader(' + this.id + ')#worker:break::total,maxFetches', total, this.maxFetches);
              return _context.abrupt('break', 13);

            case 12:
              if (count > 0 && !this.destroyed) {
                _context.next = 6;
                break;
              }

            case 13:

              logger.log('DataLoader(' + this.id + ')#worker:done::total', total);

              this.isLoading = false;
              done(true);

            case 16:
            case 'end':
              return _context.stop();
          }
        }
      }, _workerGen, this);
    })

    /**
     * Begin loading for all sources. Uses a generator to manage the tasks.
     */

  }, {
    key: 'load',
    value: function load() {
      var _this4 = this;

      logger.log('DataLoader(' + this.id + ')#load');

      return new Promise(function (resolve) {
        if (_this4.isLoading || _this4.destroyed) {
          resolve(false);
        } else {
          _this4._worker = _this4._workerGen(resolve);
          _this4._worker.next();
        }
      });
    }
  }, {
    key: 'isLoading',
    get: function get() {
      return this.model.dataLoading;
    },
    set: function set(newIsLoading) {
      if (this.model) this.model.dataLoading = newIsLoading;

      if (newIsLoading) logger.time('DataLoader(' + this.id + ').load');else logger.timeEnd('DataLoader(' + this.id + ').load');
    }
  }]);

  return DataLoader;
}();