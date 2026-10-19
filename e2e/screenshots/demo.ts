import type { FauxReplyStep } from "../../packages/core/src/testing/faux-replies";

export interface DemoReply {
  readonly prompt: string;
  readonly steps: readonly FauxReplyStep[];
}

export interface DemoThread extends DemoReply {
  readonly project: string;
  readonly title: string;
}

export interface DemoProject {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

const INVOICES = `const invoices = Array.from({ length: 120 }, (_, index) => ({ id: index + 1, total: 40 + index }));

export function listInvoices({ limit = 50 } = {}) {
  return { items: invoices.slice(0, limit) };
}
`;

const INVOICES_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import { listInvoices } from "../src/invoices.js";

test("lists the first page", () => {
  assert.equal(listInvoices({ limit: 10 }).items.length, 10);
});

test("continues after the cursor", () => {
  const first = listInvoices({ limit: 10 });
  const second = listInvoices({ limit: 10, cursor: first.nextCursor });
  assert.equal(second.items[0].id, 11);
});

test("ends with no cursor", () => {
  assert.equal(listInvoices({ limit: 500 }).nextCursor, null);
});
`;

const PAGINATED = `export function listInvoices({ limit = 50, cursor = 0 } = {}) {
  const items = invoices.slice(cursor, cursor + limit);
  const next = cursor + items.length;
  return { items, nextCursor: next < invoices.length ? next : null };
}`;

const THEME = `export const themes = ["light", "dark", "system"];

export function applyTheme(name) {
  document.documentElement.dataset.theme = themes.includes(name) ? name : "system";
}
`;

const CART = `export function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function withDiscount(total, percent) {
  return total - total * (percent / 100);
}
`;

const PAYMENTS = `export async function charge(client, order) {
  const response = await client.post("/charges", { amount: order.total, currency: "usd" });
  return response.json();
}
`;

const CHECKOUT = `import { cartTotal, withDiscount } from "./cart.js";
import { charge } from "./payments.js";

export async function checkout(client, cart, coupon) {
  const total = withDiscount(cartTotal(cart.items), coupon?.percent ?? 0);
  const receipt = await charge(client, { total });
  return { total, receipt };
}
`;

const SLUG = `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
`;

export const PROJECTS: readonly DemoProject[] = [
  {
    name: "invoicer",
    files: {
      "package.json": '{ "type": "module" }\n',
      "src/invoices.js": INVOICES,
      "test/invoices.test.js": INVOICES_TEST,
    },
  },
  { name: "blog", files: { "src/slug.js": SLUG, "README.md": "# blog\n" } },
  { name: "dashboard", files: { "src/theme.js": THEME, "README.md": "# dashboard\n" } },
  {
    name: "storefront",
    files: { "src/cart.js": CART, "src/payments.js": PAYMENTS, "src/checkout.js": CHECKOUT },
  },
];

const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const read = (path: string) => call("read", { path });
const review = (description: string, prompt: string) =>
  call("agent", { description, prompt, run_in_background: false });

const OLD_BODY = `export function listInvoices({ limit = 50 } = {}) {
  return { items: invoices.slice(0, limit) };
}`;

const CART_PROMPT = "Review how the cart total is computed and report anything that can go wrong";
const PAYMENTS_PROMPT =
  "Review how payments.js handles a failed charge and report anything that can go wrong";
const COUPON_PROMPT = "Review how checkout.js applies a coupon and report anything that can go wrong";
const TYPES_PROMPT = "List every place that calls applyTheme and what it passes";
const DOCS_PROMPT = "Write a short migration note for moving theme.js to TypeScript";

export const SUBAGENT_REPLIES: readonly DemoReply[] = [
  {
    prompt: CART_PROMPT,
    steps: [
      { tools: [read("src/cart.js")] },
      {
        text: "Two risks in `cartTotal` and `withDiscount`:\n\n- Prices are floats, so `0.1 + 0.2` style rounding leaks into the total. Work in cents.\n- `withDiscount` accepts any percent, so 120% gives a negative total.",
      },
    ],
  },
  {
    prompt: PAYMENTS_PROMPT,
    steps: [
      { tools: [read("src/payments.js")] },
      {
        text: "`charge` never checks `response.ok`, so a declined card returns the error body as if it were a receipt. A network error also escapes with no retry and no idempotency key, so a retry could charge twice.",
      },
    ],
  },
  {
    prompt: COUPON_PROMPT,
    steps: [
      { tools: [read("src/checkout.js")] },
      {
        text: "Coupons are applied but never validated: an expired or unknown coupon with a `percent` still discounts the cart. `checkout` also returns `total` as a float that may differ from the amount actually charged.",
      },
    ],
  },
  {
    prompt: TYPES_PROMPT,
    steps: [
      { tools: [read("src/theme.js")] },
      { text: "`applyTheme` is only defined in `src/theme.js`; nothing else in the project calls it yet." },
    ],
  },
  {
    prompt: DOCS_PROMPT,
    steps: [
      {
        text: "Migration note:\n\n1. Rename `theme.js` to `theme.ts`.\n2. Type `themes` as a readonly tuple and derive `ThemeName` from it.\n3. Make `applyTheme` take `ThemeName` and keep the `system` fallback for untyped callers.",
      },
    ],
  },
];

export const THREADS: readonly DemoThread[] = [
  {
    project: "blog",
    title: "Trim dashes from slugs",
    prompt: "slugify leaves dashes at both ends of a title, can you fix that?",
    steps: [
      {
        text: "Titles that start or end with punctuation leave a dash behind. I'll trim them.",
        tools: [
          call("edit", {
            path: "src/slug.js",
            edits: [
              {
                oldText: '  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");',
                newText: '  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");',
              },
            ],
          }),
        ],
      },
      { text: 'Fixed: `slugify("  Hello, world! ")` is now `hello-world`.' },
    ],
  },
  {
    project: "invoicer",
    title: "Cursor pagination for invoices",
    prompt: "Add cursor pagination to listInvoices so large accounts stop timing out",
    steps: [
      {
        thinking:
          "listInvoices returns the first `limit` rows and nothing else, so callers cannot reach the rest.",
        text: "Let me look at how `listInvoices` is built today.",
        tools: [read("src/invoices.js")],
      },
      {
        text: "It slices the first `limit` rows and has no way to continue. I'll add a numeric `cursor` and return `nextCursor` with every page.",
        tools: [
          call("edit", { path: "src/invoices.js", edits: [{ oldText: OLD_BODY, newText: PAGINATED }] }),
        ],
      },
      {
        text: "Now the tests that cover the first page, the second page and the last page.",
        tools: [call("bash", { command: "node --test" })],
      },
      {
        text: "Cursor pagination is in and the three tests pass.\n\n- `listInvoices({ limit, cursor })` returns `{ items, nextCursor }`\n- `nextCursor` is `null` on the last page, so clients know when to stop\n- Existing callers keep working: `cursor` defaults to the start\n\nNext I would expose `cursor` in the HTTP handler and document it.",
      },
    ],
  },
  {
    project: "dashboard",
    title: "Move the theme code to TypeScript",
    prompt:
      "Plan moving the dashboard theme code to TypeScript. Find the callers and draft the migration steps.",
    steps: [
      {
        text: "Two things to find out first, so I'll run them side by side.",
        tools: [review("Find applyTheme callers", TYPES_PROMPT), review("Draft migration note", DOCS_PROMPT)],
      },
      {
        text: "The move is small: `applyTheme` has no other callers, so nothing else changes.\n\nFollow the three migration steps above, then add `tsc --noEmit` to CI.",
      },
    ],
  },
  {
    project: "storefront",
    title: "Review checkout before launch",
    prompt:
      "Review the checkout code before launch. Check the cart math, payment errors and coupons in parallel.",
    steps: [
      {
        text: "I'll send three reviewers in parallel, one per area.",
        tools: [
          review("Cart math", CART_PROMPT),
          review("Payment errors", PAYMENTS_PROMPT),
          review("Coupons", COUPON_PROMPT),
        ],
      },
      {
        text: "All three reviews are back. Fix these before launch:\n\n1. **Payments:** check `response.ok` in `charge` and send an idempotency key.\n2. **Cart:** compute totals in cents and clamp the discount to 0-100%.\n3. **Coupons:** validate the coupon before `withDiscount` runs.\n\nI can start with the payment fix, since it can double charge a customer.",
      },
    ],
  },
];
