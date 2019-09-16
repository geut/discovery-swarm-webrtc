const crypto = require('crypto')
const createGraph = require('ngraph.graph')
const createGraphPath = require('ngraph.path')
const waitForExpect = require('wait-for-expect')
const getPort = require('get-port')
const wrtc = require('wrtc')

const debug = require('debug')
const { addPeer } = require('./helpers/peers')

const log = debug('test:connectivity')
debug.enable('test:connectivity')

const MAX_NODES = 50
const MIN_LINKS = 56
const TIMEOUT = 30 * 1000

jest.setTimeout(TIMEOUT)

beforeAll(async () => {
  this.server = require('http').createServer()
  const io = require('socket.io')(this.server)

  require('../server')({ io })

  this.port = await getPort()

  return new Promise(resolve => this.server.listen(this.port, () => {
    log('discovery-signal-webrtc running on %s', this.port)
    resolve()
  }))
})

afterAll(() => {
  return new Promise(resolve => this.server.close(resolve))
})

beforeEach(() => {
  this.graph = createGraph()
  this.topic = crypto.randomBytes(32)
})

afterEach(async () => {
  const wait = []
  this.graph.forEachNode(node => {
    wait.push(node.data.close())
  })
  return Promise.all(wait)
})

test(`graph connectivity for ${MAX_NODES} peers (minConnections=${MIN_LINKS})`, async () => {
  const swarms = [...Array(MAX_NODES).keys()].map(n => addPeer(
    this.graph,
    this.topic,
    {
      bootstrap: [`http://localhost:${this.port}`],
      simplePeer: {
        wrtc
      }
    }
  ))

  log(`Waiting for a minimum amount of ${MIN_LINKS} connections.`)

  await waitForExpect(() => {
    expect(this.graph.getLinksCount()).toBeGreaterThanOrEqual(MIN_LINKS)
  }, Math.floor(TIMEOUT / 2), 1 * 1000)

  log(`Testing connectivity for ${this.graph.getNodesCount()} peers.`)

  const pathFinder = createGraphPath.aStar(this.graph)
  const fromId = swarms[0].id.toString('hex')
  this.graph.forEachNode(function (node) {
    if (node.id === fromId) return
    expect(pathFinder.find(fromId, node.id).length).toBeGreaterThan(0)
    expect(node.data.getPeers().find(peer => !peer.socket)).toBeUndefined()
  })
})
