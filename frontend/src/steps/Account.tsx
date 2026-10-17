import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { api, ApiError } from "../api";
import { nextPath } from "../app/progress";
import { ErrorSummary, TextField } from "../components/Fields";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";

const signInSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(1, { error: "Enter your password." }),
});
const signUpSchema = signInSchema.extend({
  password: z.string().min(10, { error: "Use at least 10 characters." }),
  invite_code: z.string().trim().min(1, { error: "Enter the invite code from your clinic." }),
});
type FormValues = z.infer<typeof signUpSchema>;

export function Account() {
  const [params] = useSearchParams();
  const signIn = params.get("mode") === "signin";
  const location = useLocation();
  const adult = (location.state as { adult?: boolean } | null)?.adult === true;
  if (!signIn && !adult) return <Navigate to="/" replace />;
  return <AccountForm key={signIn ? "in" : "up"} signIn={signIn} />;
}

function AccountForm({ signIn }: { signIn: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(signIn ? (signInSchema as unknown as typeof signUpSchema) : signUpSchema),
    shouldFocusError: true,
  });

  const onSubmit = async (v: FormValues) => {
    setServerError(undefined);
    try {
      if (signIn) await api.login({ email: v.email, password: v.password });
      else await api.signup({ email: v.email, password: v.password, invite_code: v.invite_code.trim(), adult_attestation: true });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      const me = signIn ? await api.me() : null;
      navigate(me?.role === "staff" ? "/staff" : signIn ? nextPath(await api.progress()) : "/consent");
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("error.generic"));
    }
  };

  const summary = Object.entries(errors).map(([field, e]) => ({ field, message: e?.message ?? "" }));
  if (serverError) summary.unshift({ field: "email", message: serverError });

  return (
    <StepPage title={signIn ? t("account.signInTitle") : t("account.title")} back="/">
      <ErrorSummary errors={summary} />
      <form className="stack" noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
        <TextField id="email" label={t("account.email")} type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <TextField
          id="password"
          label={t("account.password")}
          type="password"
          autoComplete={signIn ? "current-password" : "new-password"}
          hint={signIn ? undefined : t("account.passwordHint")}
          error={errors.password?.message}
          {...register("password")}
        />
        {!signIn && (
          <TextField
            id="invite_code"
            label={t("account.invite")}
            hint={t("account.inviteHint")}
            autoComplete="off"
            error={errors.invite_code?.message}
            {...register("invite_code")}
          />
        )}
        <button type="submit" className="btn btn--block" disabled={isSubmitting}>
          {signIn ? t("account.signIn") : t("account.create")}
        </button>
      </form>
      {signIn ? (
        <p>
          <Link to="/">{t("account.needAccount")}</Link>
        </p>
      ) : (
        <p>
          <Link to="/account?mode=signin">{t("account.haveAccount")}</Link>
        </p>
      )}
    </StepPage>
  );
}
