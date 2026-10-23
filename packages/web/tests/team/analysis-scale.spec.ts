import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { normalizeAnalysis } from "../../../../supabase/functions/_shared/studio-contract";
import AnalysisPanel from "../../team/AnalysisPanel.vue";

const legacy = {
  score: 6.8,
  summary: "结构基本清晰，但关键材质与空间关系需要补充。",
  dimensions: [{ name: "保真度", score: 6.9, reason: "主体结构有依据" }],
  suggestions: [
    {
      title: "补充结构",
      instruction: "按原图补充面板结构",
      reason: "改善保真度",
    },
  ],
};
describe("declared analysis scales", () => {
  it("converts only an explicitly declared ten-point scale, for overall and dimensions together", () => {
    const result = normalizeAnalysis(
      { ...legacy, scoreScale: 10 },
      { requireScale: true },
    );
    expect(result.scoreScale).toBe(100);
    expect(result.score).toBe(68);
    expect(result.dimensions[0].score).toBe(69);
  });
  it("does not inflate a genuinely low score on an explicitly declared percentage scale", () => {
    const result = normalizeAnalysis(
      {
        ...legacy,
        scoreScale: 100,
        score: 6,
        dimensions: [{ ...legacy.dimensions[0], score: 7 }],
      },
      { requireScale: true },
    );
    expect(result.score).toBe(6);
    expect(result.dimensions[0].score).toBe(7);
  });
  it("preserves an ambiguous historic number without inventing a scale", () => {
    const result = normalizeAnalysis(legacy);
    expect(result.score).toBe(6.8);
    expect(result.scoreScale).toBeUndefined();
  });
  it("rejects new output without a declared scale", () => {
    expect(() => normalizeAnalysis(legacy, { requireScale: true })).toThrow(
      "INVALID_SCORE_SCALE",
    );
  });
  it.each([0, 5, 50, "100"])(
    "rejects an unsupported declared scale %s",
    (scoreScale) => {
      expect(() =>
        normalizeAnalysis({ ...legacy, scoreScale }, { requireScale: true }),
      ).toThrow("INVALID_SCORE_SCALE");
    },
  );
  it("rejects values outside the declared range rather than clamping or guessing", () => {
    expect(() =>
      normalizeAnalysis(
        { ...legacy, scoreScale: 10, score: 11 },
        { requireScale: true },
      ),
    ).toThrow("INVALID_SCORE_SCALE");
    expect(() =>
      normalizeAnalysis({ ...legacy, scoreScale: 100 }, { requireScale: true }),
    ).toThrow("INVALID_SCORE_SCALE");
  });
  it("labels ambiguous old scores and hides percentage bars while keeping advice usable", () => {
    const wrapper = mount(AnalysisPanel, {
      props: {
        result: normalizeAnalysis(legacy),
        title: "历史分析",
        busy: false,
        stale: false,
      },
    });
    expect(wrapper.text()).toContain("量表待确认");
    expect(wrapper.get(".score").text()).not.toContain("100");
    expect(wrapper.findAll(".dimension-track")).toHaveLength(0);
    expect(
      wrapper.get(".suggestions button").attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });
  it("renders an explicit normalized scale as a percentage with a matching dimension bar", () => {
    const wrapper = mount(AnalysisPanel, {
      props: {
        result: normalizeAnalysis({ ...legacy, scoreScale: 10 }),
        title: "质量分析",
        busy: false,
        stale: false,
      },
    });
    expect(wrapper.get(".score").text()).toContain("68/ 100");
    expect(wrapper.get(".dimension-track i").attributes("style")).toContain(
      "69%",
    );
    expect(wrapper.text()).not.toContain("量表待确认");
    wrapper.unmount();
  });
});
