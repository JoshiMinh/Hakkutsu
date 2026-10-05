const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function render(activities, metric = "all") {
  const changes = [];
  const focused = [];
  let hook = 0;
  const source = ts.transpileModule(
    fs.readFileSync("src/features/analytics/activity-heatmap.tsx", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const context = {
    exports: {},
    document: { getElementById: (id) => ({ focus: () => focused.push(id) }) },
    require: (name) =>
      name === "react"
        ? {
            ...React,
            useState: () => [
              hook++ === 0 ? metric : null,
              (value) => changes.push(value),
            ],
          }
        : name === "~/shared/locales"
          ? { useTranslation: () => ({ t: (key) => key, lang: "en" }) }
          : require(name),
  };
  vm.runInNewContext(source, context);
  const tree = context.exports.ActivityHeatmap({ activities });
  const elements = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    elements.push(node);
    React.Children.forEach(node.props.children, visit);
  }
  visit(tree);
  return { elements, html: renderToStaticMarkup(tree), changes, focused };
}

const days = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-10-${String(index + 1).padStart(2, "0")}`,
  charactersRead: index * 25,
  videoImmersionSeconds: index * 60,
  miningVolume: index,
  reviewsCount: index,
  passedReviewsCount: index,
  retentionRate: 100,
}));

test("calendar aligns a Thursday start to Monday-based weekday rows and preserves all dates", () => {
  const { elements } = render(days);
  const weeks = elements.filter(
    (node) => node.props.className === "hk-dashboard-calendar__week",
  );
  const first = React.Children.toArray(weeks[0].props.children).slice(1);
  assert.equal(
    first
      .slice(0, 3)
      .every((node) => node.props.className === "hk-dashboard-calendar__blank"),
    true,
  );
  assert.equal(first[3].props.id, "dashboard-day-2026-10-01");
  const buttons = elements.filter((node) => node.type === "button");
  assert.equal(buttons.length, days.length);
  assert.equal(buttons.filter((node) => node.props.tabIndex === 0).length, 1);
  assert.equal(buttons.at(-1).props.tabIndex, 0);
});

test("calendar arrow keys move one week horizontally and one day vertically", () => {
  const { elements, changes, focused } = render(days);
  const button = elements.find(
    (node) => node.props.id === "dashboard-day-2026-10-01",
  );
  let prevented = 0;
  button.props.onKeyDown({
    key: "ArrowRight",
    preventDefault: () => prevented++,
  });
  button.props.onKeyDown({
    key: "ArrowDown",
    preventDefault: () => prevented++,
  });
  assert.deepEqual(changes, ["2026-10-08", "2026-10-02"]);
  assert.deepEqual(focused, [
    "dashboard-day-2026-10-08",
    "dashboard-day-2026-10-02",
  ]);
  assert.equal(prevented, 2);
});

test("empty activity and zero-valued dates render without fabricated activity", () => {
  assert.match(render([]).html, /dash_activity_empty/);
  const { elements } = render([days[0]], "characters");
  const button = elements.find((node) => node.type === "button");
  assert.match(button.props.className, /hk-dashboard-intensity--0/);
});
