'use strict'

const log = require('./log')
const format = require('./format')
const SpanSampler = require('./span_sampler')
const GitMetadataTagger = require('./git_metadata_tagger')
const id = require('./id');

const { SpanStatsProcessor } = require('./span_stats')

const startedSpans = new WeakSet()
const finishedSpans = new WeakSet()

class SpanProcessor {
  constructor (exporter, prioritySampler, config) {
    this._exporter = exporter
    this._prioritySampler = prioritySampler
    this._config = config
    this._killAll = false

    this._stats = new SpanStatsProcessor(config)
    this._spanSampler = new SpanSampler(config.sampler)
    this._gitMetadataTagger = new GitMetadataTagger(config)
  }

  process (span) {
    const spanContext = span.context()
    const active = []
    const formatted = []
    const trace = spanContext._trace
    const { flushMinSpans } = this._config
    const { started, finished } = trace

    if (trace.record === false) return
    if (started.length === finished.length || finished.length >= flushMinSpans) {
      this._prioritySampler.sample(spanContext)
      this._spanSampler.sample(spanContext)
      this._gitMetadataTagger.tagGitMetadata(spanContext)

      const clonedFormattedSpanMap = new Map();
      for (const span of started) {
        if (span._duration !== undefined) {
          const formattedSpan = format(span)
          this._stats.onSpanFinished(formattedSpan)

          if (formattedSpan.meta._multiparents) {
            const multiparents = formattedSpan.meta._multiparents.split("|");
            formattedSpan.trace_id = id(multiparents[0]);
            for (let i = 1; i < multiparents.length; i++) {
              const trace_id = multiparents[i];
              let clonedFormattedSpans = [];
              if (clonedFormattedSpanMap.get(trace_id)) {
                clonedFormattedSpans = clonedFormattedSpanMap.get(trace_id)
              }

              clonedFormattedSpans.push({
                ...formattedSpan,
                trace_id: id(trace_id)
              });
              clonedFormattedSpanMap.set(trace_id, clonedFormattedSpans);
            }
          }

          formatted.push(formattedSpan);
        } else {
          active.push(span)
        }
      }

      if (formatted.length !== 0 && trace.isRecording !== false) {
        this._exporter.export(formatted)
      }
      if (clonedFormattedSpanMap.size > 0) {
        const spanSets = [...clonedFormattedSpanMap.values()];
        for (let i = 0; i < spanSets.length; i++) {
          console.log(spanSets[i]);
          this._exporter.export(spanSets[i]);
        }
      }


      this._erase(trace, active)
    }

    if (this._killAll) {
      started.map(startedSpan => {
        if (!startedSpan._finished) {
          startedSpan.finish()
        }
      })
    }
  }

  killAll () {
    this._killAll = true
  }

  _erase (trace, active) {
    if (process.env.DD_TRACE_EXPERIMENTAL_STATE_TRACKING === 'true') {
      const started = new Set()
      const startedIds = new Set()
      const finished = new Set()
      const finishedIds = new Set()

      for (const span of trace.finished) {
        const context = span.context()
        const id = context.toSpanId()

        if (finished.has(span)) {
          log.error(`Span was already finished in the same trace: ${span}`)
        } else {
          finished.add(span)

          if (finishedIds.has(id)) {
            log.error(`Another span with the same ID was already finished in the same trace: ${span}`)
          } else {
            finishedIds.add(id)
          }

          if (context._trace !== trace) {
            log.error(`A span was finished in the wrong trace: ${span}.`)
          }

          if (finishedSpans.has(span)) {
            log.error(`Span was already finished in a different trace: ${span}`)
          } else {
            finishedSpans.add(span)
          }
        }
      }

      for (const span of trace.started) {
        const context = span.context()
        const id = context.toSpanId()

        if (started.has(span)) {
          log.error(`Span was already started in the same trace: ${span}`)
        } else {
          started.add(span)

          if (startedIds.has(id)) {
            log.error(`Another span with the same ID was already started in the same trace: ${span}`)
          } else {
            startedIds.add(id)
          }

          if (context._trace !== trace) {
            log.error(`A span was started in the wrong trace: ${span}.`)
          }

          if (startedSpans.has(span)) {
            log.error(`Span was already started in a different trace: ${span}`)
          } else {
            startedSpans.add(span)
          }
        }

        if (!finished.has(span)) {
          log.error(`Span started in one trace but was finished in another trace: ${span}`)
        }
      }

      for (const span of trace.finished) {
        if (!started.has(span)) {
          log.error(`Span finished in one trace but was started in another trace: ${span}`)
        }
      }
    }

    for (const span of trace.finished) {
      span.context()._tags = {}
    }

    trace.started = active
    trace.finished = []
  }
}

module.exports = SpanProcessor
