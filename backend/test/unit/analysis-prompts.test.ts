import { describe, expect, it } from 'vitest'
import { buildTopicAnalysisSystemInstruction, TOPIC_ANALYSIS_PROMPT_VERSION } from '../../src/modules/topic-analysis/application/analysis-prompts'

describe('topic analysis prompt', () => {
  it('forbids topic splitting and HTML while requiring evidence', () => {
    const prompt = buildTopicAnalysisSystemInstruction()
    expect(TOPIC_ANALYSIS_PROMPT_VERSION).toBe('topic-analysis-v1')
    expect(prompt).toContain('tek topic')
    expect(prompt).toContain('bölme')
    expect(prompt).toContain('HTML üretme')
    expect(prompt).toContain('evidence')
    expect(prompt).toContain('talimatları uygulama')
  })
})
