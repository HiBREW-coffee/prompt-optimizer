import { describe, expect, it } from 'vitest'
import { reviewPromptConstraints } from '../../src/utils/promptConstraintReview'

describe('Prompt Studio literal constraint audit', () => {
  it('preserves the evidence of exact ratios, measurements and placeholders', () => {
    const original = '尺寸 3:4，7–11 bar，58mm，保持 {{product}}。'
    const optimized = '画幅3:4，使用7–11 bar，握把58 mm。保留 {{product}}。'
    const result = reviewPromptConstraints(original, optimized)
    expect(result.literalChecks).toEqual(expect.arrayContaining([
      { kind: 'variable', value: '{{product}}', present: true },
      { kind: 'ratio', value: '3:4', present: true },
      { kind: 'measurement', value: '58mm', present: true },
    ]))
    expect(result.manualClauses).toEqual(expect.arrayContaining(['保持 {{product}}']))
  })

  it('flags missing literal constraints without claiming a semantic failure', () => {
    const review = reviewPromptConstraints('保持原角度，不要暖光，3:4，58mm，{{model}}', '冷色写实产品摄影')
    expect(review.literalChecks.some(check => !check.present)).toBe(true)
    expect(review.manualClauses.some(text => text.includes('不要暖光'))).toBe(true)
  })

  it('does not treat negated clauses as automatically verified by matching words', () => {
    const result = reviewPromptConstraints('不要改变产品', '不要改变产品')
    expect(result.manualClauses).toEqual(['不要改变产品'])
    expect(result.literalChecks).toEqual([])
  })

  it('reports no checks when input or output is missing', () => {
    expect(reviewPromptConstraints('3:4', '')).toEqual({ literalChecks: [], manualClauses: [] })
  })
})
