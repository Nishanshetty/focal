import { createRootRoute, createRoute } from "@tanstack/react-router";
import RootLayout from "./pages/RootLayout";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import AnalyticsPage from "./pages/AnalyticsPage";

const rootRoute = createRootRoute({ component: RootLayout });

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/analytics",
  component: AnalyticsPage,
});

export const routeTree = rootRoute.addChildren([homeRoute, settingsRoute, analyticsRoute]);
