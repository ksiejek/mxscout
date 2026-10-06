/* MxScout — Log analysis module: the Worker that masks sensitive values in a log.
 *
 * The masking logic is MxDevSwissTool's (Mikołaj / RealMecowhy, MIT), unchanged, in
 * engine/anonymizer.js — the same source its tests run. This file only starts it.
 *
 * Message in:  { rawText, opts }
 * Messages out: { type: 'progress', progress, phase } · { type: 'complete', result, rawResult, stats, totalLines }
 */
importScripts('/logs/engine/anonymizer.js');
workerLogic();
