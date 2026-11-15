// Every namespace of one language as a single chunk (see ../index.ts).
import type { MessageTree } from "../core";
import { namespacesOf } from "../namespaces";

export default namespacesOf(
  import.meta.glob<MessageTree>("../locales/zh-TW/*.json", {
    eager: true,
    import: "default",
  }),
);
