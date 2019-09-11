const { EventEmitter } = require('events')
const { delay } = require('./utils')

class Task extends EventEmitter {
  constructor (id, job, ms) {
    super()
    this._id = id
    this._job = task => job(task)
    this._ms = ms
    this._started = false
    this._destroyed = false
  }

  start () {
    if (this._started) return
    let ms = this._ms

    const run = async () => {
      this.emit('start')

      while (!this._destroyed) {
        try {
          await delay(ms)
          const newMS = await this._job(this)
          if (Number.isInteger(newMS)) {
            ms = newMS
          } else {
            ms = this._ms
          }
        } catch (err) {
          console.error(`Error in Task ${this._id}`, err.message)
        }
      }

      this.emit('destroy')
    }

    this._started = true

    run()
  }

  destroy () {
    if (this._destroyed) return
    this._destroyed = true
  }
}

class Scheduler {
  constructor () {
    this._tasks = new Map()
  }

  addTask (id, job, ms) {
    const task = new Task(id, job, ms)
    this._tasks.set(id, task)
    task.on('destroy', () => {
      if (this._tasks.has(id)) {
        this._tasks.delete(id)
      }
    })
    return task
  }

  startTask (id) {
    const task = this._tasks.get(id)
    if (task) {
      task.start()
    }
  }

  deleteTask (id) {
    const task = this._tasks.get(id)
    if (task) {
      task.destroy()
    }
  }

  clearTasks () {
    this._tasks.forEach(task => {
      task.destroy()
    })
  }
}

module.exports = Scheduler
