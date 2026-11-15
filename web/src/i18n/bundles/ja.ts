// Every namespace of one language as a single chunk (see ../index.ts).
import type { MessageTree } from "../core";
import { namespacesOf } from "../namespaces";

export default namespacesOf(
  import.meta.glob<MessageTree>("../locales/ja/*.json", {
    eager: true,
    import: "default",
  }),
);
