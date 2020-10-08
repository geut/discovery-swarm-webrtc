const test = require('tape')
const crypto = require('crypto')
const createGraph = require('ngraph.graph')
const createGraphPath = require('ngraph.path')

const { addPeer } = require('./helpers/peers')
const createSwarm = require('..')

const MAX_NODES = 100
const TIMEOUT = 50 * 1000
const URL = 'ws://localhost:4000'

test(`graph connectivity for ${MAX_NODES} peers`, async (t) => {
  t.timeoutAfter(TIMEOUT)

  const graph = createGraph()
  const topic = crypto.randomBytes(32)

  const swarms = [...Array(MAX_NODES).keys()].map(n => addPeer(
    graph,
    topic,
    {
      bootstrap: [URL]
    }
  ))

  t.comment(`Testing connectivity for ${graph.getNodesCount()} peers`)

  const pathFinder = createGraphPath.aStar(graph)
  const fromId = swarms[0].id.toString('hex')
  let end = false

  t.equal(graph.getNodesCount(), MAX_NODES, `Should have ${MAX_NODES} nodes`)

  const connected = [fromId]

  while (!end) {
    await new Promise(resolve => setTimeout(resolve, 10 * 1000))
    let found = true
    graph.forEachNode(function (node) {
      if (node.id === fromId) return
      const key = `${fromId} ${node.id}`
      if (connected.includes(key)) return
      found = found && (pathFinder.find(fromId, node.id).length > 0) && (node.data.getPeers().length > 0)
      if (!found) {
        return true
      }
      connected.push(key)
      console.log(`${fromId.slice(0, 6)}... ${node.id.slice(0, 6)}... connected`)
    })
    end = found
  }

  t.equal(connected.length, graph.getNodesCount(), 'Full network connection')

  await Promise.all(swarms.map(swarm => swarm.leave(topic)))

  t.equal(swarms.reduce((prev, curr) => prev + curr.connected.length, 0), 0, 'Should leave and disconnect from every peer')

  t.end()
})

test('direct connection', async (t) => {
  const topic = crypto.randomBytes(32)

  const swarm1 = createSwarm({
    bootstrap: [URL]
  })
  const swarm2 = createSwarm({
    bootstrap: [URL]
  })

  swarm2.join(topic)

  await new Promise(resolve => setTimeout(() => resolve(), 0))

  try {
    const [connection] = await Promise.all([
      swarm1.connect(topic, swarm2.id),
      new Promise(resolve => swarm2.once('connection', resolve))
    ])

    t.equal(swarm1.connected.length, 1, 'should have 1 connection')
    t.equal(swarm2.connected.length, 1, 'should have 1 connection')
    t.ok(connection && connection.pipe !== undefined, 'should return a connection stream')
  } catch (err) {
    t.error(err)
  }

  t.end()
})
