import { expect, test } from "@playwright/test";

test("login page validates invalid email and password", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
});

test("signup page validates required name", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Please enter your name.", { exact: true })).toBeVisible();
});

test("forgot password page renders reset request form", async ({ page }) => {
  await page.goto("/forgot");
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
});
