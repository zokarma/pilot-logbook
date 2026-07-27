// Eval #24 — help guides (src/lib/help.ts).
// /help is public, indexed, and feeds FAQ rich results, so a wrong instruction
// here misleads pilots at scale and is quoted back by AI answer engines. These
// checks guard the same way claims.eval guards the pricing copy: structure the
// page depends on, and claims the product cannot back up.

import { HELP, allHelpTopics } from "../src/lib/help";
import { helpFaqPageLd } from "../src/lib/seo";
import { FEATURE_MIN_TIER } from "../src/lib/entitlement";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(24, "Help guides (help.ts)", "Public, indexed instructions — wrong answers mislead pilots and get quoted by AI engines.");

  const topics = allHelpTopics();

  // -- structure the page relies on (anchors, jump links) --
  {
    const sectionIds = HELP.map((x) => x.id);
    const topicIds = topics.map((t) => t.id);
    s.check("section ids are unique", sectionIds.length === new Set(sectionIds).size);
    s.check("topic ids are unique (anchors don't collide)", topicIds.length === new Set(topicIds).size);
    s.check("ids are URL-safe anchors", [...sectionIds, ...topicIds].every((id) => /^[a-z0-9-]+$/.test(id)));
    s.check("every section has topics", HELP.every((x) => x.topics.length > 0));
    s.check("every topic has a question and an answer", topics.every((t) => t.question.trim().length > 8 && t.answer.trim().length > 12));
    s.check("questions read as questions", topics.filter((t) => t.question.trim().endsWith("?")).length >= topics.length - 1);
    s.check("no empty steps", topics.every((t) => (t.steps ?? []).every((st) => st.trim().length > 0)));
  }

  // -- claims the product cannot back up --
  {
    const corpus = JSON.stringify(HELP).toLowerCase();
    s.check("no Mac/desktop app claim (no macOS target ships)", !/\bmac app\b|\bmacos app\b|\bdesktop app\b/.test(corpus));
    s.check("no Android claim (iOS + web only)", !/\bandroid\b/.test(corpus));
    s.check("no Apple Watch or widget-only claims", !/apple watch|watchos/.test(corpus));
    s.check("the withdrawn Professional tier is never mentioned", !/professional plan|professional tier/.test(corpus));
    s.check("no promise of free unlimited scanning", !/(unlimited|free).{0,20}scan(ning)?.{0,20}(free|for everyone|no charge)/.test(corpus));
    s.check("no claim that exports satisfy a regulator", !/regulator|audit|inspector|legally required/.test(corpus));
    s.check("no guarantee language around currency math", !/guarantee|guaranteed|ensures compliance|keeps you legal/.test(corpus));
  }

  // -- the reference-only caveat must survive edits --
  {
    const currency = HELP.find((x) => x.id === "currency")!;
    const text = JSON.stringify(currency).toLowerCase();
    s.check("currency guidance keeps the reference-only caveat", text.includes("reference") && text.includes("cars"));
  }

  // -- PRO badges must match what the app actually gates --
  {
    const proTopics = topics.filter((t) => t.pro);
    s.check("some topics are marked PRO", proTopics.length >= 3);
    s.check("aiScan is a paid feature, so scanning topics are badged", FEATURE_MIN_TIER.aiScan !== "free" && proTopics.some((t) => t.id.includes("scan")));
    s.check("the PDF export topic is badged, matching proPdf gating", FEATURE_MIN_TIER.proPdf !== "free" && proTopics.some((t) => t.id === "export-pdf"));
    s.check("custom currency rules are badged, matching advancedCurrency gating", FEATURE_MIN_TIER.advancedCurrency !== "free" && proTopics.some((t) => t.id === "custom-currency"));
    // Things the free plan genuinely includes must NOT be badged.
    const freeIds = ["log-a-flight", "circuits", "import-csv", "export-csv", "add-document", "reminders", "offline"];
    s.check("genuinely free features are not badged PRO", freeIds.every((id) => !topics.find((t) => t.id === id)?.pro));
  }

  // -- structured data mirrors the visible page --
  {
    const ld = helpFaqPageLd() as { "@type": string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    s.check("emits a FAQPage", ld["@type"] === "FAQPage");
    s.eq("one Question per visible topic", ld.mainEntity.length, topics.length);
    s.check("every answer carries real text", ld.mainEntity.every((q) => q.acceptedAnswer.text.trim().length > 12));
    s.check("answers fold in the steps, not just the one-liner", ld.mainEntity.some((q) => q.acceptedAnswer.text.length > 160));
  }

  return s;
}
