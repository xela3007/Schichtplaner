import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { LocationDetailPage } from "@/pages/locations/LocationDetailPage";
import { LocationFormPage } from "@/pages/locations/LocationFormPage";
import { LocationListPage } from "@/pages/locations/LocationListPage";
import { StaffingFormPage } from "@/pages/locations/StaffingFormPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { SignupPage } from "@/pages/SignupPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route
              path="/standorte"
              element={
                <RequireAuth>
                  <LocationListPage />
                </RequireAuth>
              }
            />
            <Route
              path="/standorte/neu"
              element={
                <RequireAuth>
                  <LocationFormPage />
                </RequireAuth>
              }
            />
            <Route
              path="/standorte/:id"
              element={
                <RequireAuth>
                  <LocationDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/standorte/:id/bearbeiten"
              element={
                <RequireAuth>
                  <LocationFormPage />
                </RequireAuth>
              }
            />
            <Route
              path="/standorte/:id/bedarf"
              element={
                <RequireAuth>
                  <StaffingFormPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
