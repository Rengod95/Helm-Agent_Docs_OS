import { expect, test } from "bun:test";
import { COMPOSER_FOOTER_CLASS } from "../../src/views/composer.tsx";

test("the composer footer lets the submit slot shrink and keeps the left buttons whole", () => {
  const classes = COMPOSER_FOOTER_CLASS.split(" ");
  expect(classes).toContain("[&_[data-slot=textarea-submit]]:min-w-0");
  expect(classes).toContain("[&_[data-slot=textarea-actions]]:shrink-0");
});
