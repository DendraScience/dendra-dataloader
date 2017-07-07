/**
 * Utility class for fetching data based on configured sources.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module dendra-dataloader
 */

export const NEVER_FETCHED = 8640000000000000

let defaultInterval = 500
let defaultMaxFetches = 200
let nextId = 1 // Next identifier for each DataLoader instance

// Local logger that can be redirected
const logger = {}

function noLog () {}

export function configure (options) {
  if (typeof options !== 'object') return
  if (typeof options.interval === 'number') defaultInterval = options.interval
  if (typeof options.maxFetches === 'number') defaultMaxFetches = options.maxFetches
  if (typeof options.logger === 'object' || options.logger === false) {
    ['error', 'log', 'time', 'timeEnd', 'warn'].forEach(k => { logger[k] = (options.logger && options.logger[k]) || noLog })
  }
}

// Initial configuration
configure({
  logger: false
})

/**
 * Get model property keys for a given sourceKey.
 */
function propKeys (sourceKey) {
  return {
    error: `${sourceKey}Error`,
    fetchedAt: `${sourceKey}FetchedAt`,
    loading: `${sourceKey}Loading`,
    ready: `${sourceKey}Ready`
  }
}

class DataFetchTask {
  constructor (model, keys) {
    this.time = (new Date()).getTime()
    this.keys = keys
    this.model = model
  }

  run (source) {
    this.model[this.keys.fetchedAt] = this.time

    return Promise.resolve(source.fetch(this.model)).then(res => {
      if (this.model[this.keys.fetchedAt] === this.time) {
        return {
          preempted: false,
          result: res
        }
      }

      return {
        preempted: true
      }
    })
  }
}

export class DataLoader {
  constructor (model, sources) {
    this.id = nextId++
    this.interval = defaultInterval
    this.maxFetches = defaultMaxFetches // Approximate upper limit
    this.model = model
    this.sources = sources

    model.dataLoading = false
  }

  /**
   * Clear state for all sources where the specified predicate is true.
   */
  clear (pred = true) {
    const predFn = typeof pred === 'function' ? pred : function (sourceKey) {
      return (pred === true) || (sourceKey === pred)
    }
    const sources = this.sources
    const model = this.model

    Object.keys(sources).filter(predFn).forEach(sourceKey => {
      const keys = propKeys(sourceKey)
      const source = sources[sourceKey]

      logger.log(`DataLoader(${this.id})#clear::sourceKey`, sourceKey)

      model[keys.error] = null
      model[keys.loading] = false
      model[keys.ready] = false
      model[keys.fetchedAt] = NEVER_FETCHED

      // Invoke clear hook
      if (typeof source.clear === 'function') source.clear(model)
    })

    return this
  }

  /**
   * Cancel loading immediately and clean up.
   */
  destroy () {
    logger.log(`DataLoader(${this.id})#destroy`)

    this.destroyed = true
    this.sources = null
    this.model = null
  }

  get isLoading () { return this.model.dataLoading }
  set isLoading (newIsLoading) {
    if (this.model) this.model.dataLoading = newIsLoading

    if (newIsLoading) logger.time(`DataLoader(${this.id}).load`)
    else logger.timeEnd(`DataLoader(${this.id}).load`)
  }

  * _workerGen (done) {
    this.isLoading = true

    logger.log(`DataLoader(${this.id})#worker`)

    const sources = this.sources
    const model = this.model

    let count = 0
    let total = 0

    do {
      yield setTimeout(() => { this._worker.next() }, this.interval)

      Object.keys(sources).filter(sourceKey => {
        const keys = propKeys(sourceKey)
        const source = sources[sourceKey]

        if (model[keys.loading]) return false // Already loading source?

        // Evaluate guard condition
        return typeof source.guard === 'function' ? !!source.guard(model) : true
      }).map(sourceKey => {
        const keys = propKeys(sourceKey)
        const source = sources[sourceKey]

        count++
        total++

        logger.log(`DataLoader(${this.id})#worker:beforeFetch::sourceKey,count,total`, sourceKey, count, total)

        model[keys.error] = null
        model[keys.loading] = true
        model[keys.ready] = false

        // Optional beforeFetch hook
        if (typeof source.beforeFetch === 'function') source.beforeFetch(model)

        return (new DataFetchTask(model, keys)).run(source).then(state => {
          logger.log(`DataLoader(${this.id})#worker:afterFetch::sourceKey,state`, sourceKey, state)

          model[keys.loading] = false

          if (this.destroyed || !state || state.preempted) return

          // Process results
          let res = state.result
          if (typeof source.afterFetch === 'function') res = source.afterFetch(model, res)
          if (!res) throw Error(`Not found: ${sourceKey}`)

          // Assign targets
          if (typeof source.assign === 'function') source.assign(model, res)

          model[keys.ready] = true
        }).catch(err => {
          logger.error(`DataLoader(${this.id})#worker:catch::sourceKey,err`, sourceKey, err)

          if (this.destroyed) return

          model[keys.loading] = false
          model[keys.error] = err.message
        }).then(() => {
          count--
        })
      })

      // Safety net
      if (total > this.maxFetches) {
        logger.warn(`DataLoader(${this.id})#worker:break::total,maxFetches`, total, this.maxFetches)
        break
      }
    } while (count > 0 && !this.destroyed)

    logger.log(`DataLoader(${this.id})#worker:done::total`, total)

    this.isLoading = false
    done(true)
  }

  /**
   * Begin loading for all sources. Uses a generator to manage the tasks.
   */
  load () {
    logger.log(`DataLoader(${this.id})#load`)

    return new Promise((resolve) => {
      if (this.isLoading || this.destroyed) {
        resolve(false)
      } else {
        this._worker = this._workerGen(resolve)
        this._worker.next()
      }
    })
  }
}
