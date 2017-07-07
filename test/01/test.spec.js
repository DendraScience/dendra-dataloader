/**
 * Main tests
 */

describe('Module', function () {
  let dataloader

  // Simple logging to an array
  const logEntries = []
  const logger = {
    log: (...args) => {
      logEntries.push([...args].join(' '))
    }
  }

  it('should import', function () {
    dataloader = require('../../dist')

    expect(dataloader).to.have.property('DataLoader')
    expect(dataloader).to.have.property('NEVER_FETCHED')
  })

  it('should load source', function () {
    let afterFetchRes

    const model = {}
    const sources = {
      a: {
        clear (m) {
          m.value = null
        },
        guard (m) {
          return !m.value
        },
        fetch (m) {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              resolve({some: 'data'})
            }, 200)
          })
        },
        afterFetch (m, res) {
          afterFetchRes = res
          return res
        },
        assign (m, res) {
          m.value = res
        }
      }
    }

    dataloader.configure({
      interval: 200,
      logger: logger
    })

    const loader = new dataloader.DataLoader(model, sources)

    expect(loader).to.have.property('interval', 200)

    return loader.clear().load().then(() => {
      expect(model).to.deep.include({
        aError: null,
        aLoading: false,
        aReady: true,
        dataLoading: false,
        value: {
          some: 'data'
        }
      })
      expect(afterFetchRes).to.deep.equal({
        some: 'data'
      })
      expect(logEntries).to.have.lengthOf(6)
    })
  })
})
