import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { api, ApiError, type ExtractResult, type FieldName, type FieldSource } from "../api";
import { useDraft } from "../app/draft";
import { useSupport, useSupportActions } from "../app/support";
import { DateOfBirthInput } from "../components/DateOfBirthInput";
import { ErrorSummary, TextField, type Provenance } from "../components/Fields";
import { StepPage } from "../components/StepPage";
import { joinAddress, splitAddress } from "../features/address";
import { ageOn, dobToIso, splitDob } from "../features/dob";
import { t } from "../i18n";

const plain = (s: string) => !/[<>{}]/.test(s);

const schema = z
  .object({
    full_name: z.string().trim().min(3, { error: t("confirm.err.name") }).max(120).refine(plain, { error: t("confirm.err.name") }),
    month: z.string().trim(),
    day: z.string().trim(),
    year: z.string().trim(),
    street: z.string().trim().min(3, { error: t("confirm.err.street") }).max(160).refine(plain, { error: t("confirm.err.street") }),
    city: z.string().trim().min(2, { error: t("confirm.err.city") }).max(60).refine(plain, { error: t("confirm.err.city") }),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/, { error: t("confirm.err.state") }),
    zip: z.string().trim().regex(/^\d{5}$/, { error: t("confirm.err.zip") }),
  })
  // Date-of-birth problems are reported on the month input, the first of the three.
  .superRefine((v, ctx) => {
    const iso = dobToIso(v);
    if (!iso || ageOn(iso) > 120) ctx.addIssue({ code: "custom", path: ["month"], message: t("confirm.err.dob") });
    else if (ageOn(iso) < 18) ctx.addIssue({ code: "custom", path: ["month"], message: t("confirm.err.adult") });
  });
type Values = z.infer<typeof schema>;

const ADDRESS_PARTS = ["street", "city", "state", "zip"] as const;
const FIRST_FIELD_ORDER = ["full_name", "month", "day", "year", ...ADDRESS_PARTS] as const;

function defaults(extracted: ExtractResult | null): Values {
  const dob = splitDob(extracted?.fields.dob?.value);
  const address = splitAddress(extracted?.fields.address?.value);
  return { full_name: extracted?.fields.full_name?.value ?? "", ...dob, ...address };
}

export function ConfirmDetails() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const support = useSupport();
  const failed = (useLocation().state as { failed?: boolean } | null)?.failed === true;
  const extracted = draft.extracted;
  const initial = defaults(extracted);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, dirtyFields },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial, shouldFocusError: true });

  // From the photo, untouched: tag it, and say so when OCR was unsure. Missing from the photo: say so. Typed by hand: no tag.
  const provenance = (field: FieldName, filled: boolean, dirty: boolean): Provenance => {
    if (!extracted || dirty) return null;
    if (!filled) return "missing";
    return extracted.fields[field]?.status === "low_confidence" ? "unsure" : "ocr";
  };
  const dobDirty = Boolean(dirtyFields.month || dirtyFields.day || dirtyFields.year);

  useEffect(() => {
    if (!extracted) return;
    const firstEmpty = FIRST_FIELD_ORDER.find((f) => !initial[f]);
    if (firstEmpty) setFocus(firstEmpty);
    if (extracted.needs_review.length) void support.show({ ocr_low_confidence: true });
    // Run once per extraction result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted]);

  useSupportActions((action) => {
    if (action === "try_again") {
      navigate("/details");
      return true;
    }
    return action === "type_instead" || action === "check_details";
  });

  const save = useMutation({
    mutationFn: (v: Values) => {
      const source = (field: FieldName, dirty: boolean): FieldSource => {
        if (!extracted?.fields[field]?.value) return "manual";
        return dirty ? "ocr_edited" : "ocr_confirmed";
      };
      const addressDirty = ADDRESS_PARTS.some((p) => dirtyFields[p]);
      return api.saveIdentity({
        full_name: v.full_name.trim(),
        dob: dobToIso(v)!,
        address: joinAddress(v),
        sources: {
          full_name: source("full_name", Boolean(dirtyFields.full_name)),
          dob: source("dob", dobDirty),
          address: source("address", addressDirty),
        },
      });
    },
    onSuccess: async () => {
      draft.setExtracted(null); // what OCR read is no longer needed once saved
      await queryClient.invalidateQueries({ queryKey: ["progress"] });
      navigate("/book");
    },
  });

  const summary = Object.entries(errors).map(([field, e]) => ({ field: field === "month" ? "dob-month" : field, message: e?.message ?? "" }));
  if (save.error instanceof ApiError) summary.unshift({ field: "full_name", message: save.error.fieldErrors[0]?.message ?? save.error.message });

  const title = extracted ? t("confirm.title") : failed ? t("details.failedTitle") : t("details.manualTitle");
  const lead = extracted ? t("confirm.lead") : failed ? t("details.failedBody") : t("confirm.manualLead");

  return (
    <StepPage title={title} step={extracted ? 4 : 3} back="/details" lead={<p>{lead}</p>}>
      <ErrorSummary errors={summary} />
      <form className="stack" noValidate onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)}>
        <TextField
          id="full_name"
          label={t("confirm.name")}
          autoComplete="name"
          provenance={provenance("full_name", Boolean(initial.full_name), Boolean(dirtyFields.full_name))}
          error={errors.full_name?.message}
          {...register("full_name")}
        />
        <DateOfBirthInput
          register={register as never}
          error={errors.month?.message}
          provenance={provenance("dob", Boolean(initial.year), dobDirty)}
        />
        <TextField
          id="street"
          label={t("confirm.street")}
          autoComplete="address-line1"
          provenance={provenance("address", Boolean(initial.street), Boolean(dirtyFields.street))}
          error={errors.street?.message}
          {...register("street")}
        />
        <div className="address-row">
          <TextField
            id="city"
            label={t("confirm.city")}
            autoComplete="address-level2"
            provenance={provenance("address", Boolean(initial.city), Boolean(dirtyFields.city))}
            error={errors.city?.message}
            {...register("city")}
          />
          <TextField
            id="state"
            label={t("confirm.state")}
            autoComplete="address-level1"
            maxLength={2}
            provenance={provenance("address", Boolean(initial.state), Boolean(dirtyFields.state))}
            error={errors.state?.message}
            {...register("state")}
          />
          <TextField
            id="zip"
            label={t("confirm.zip")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={5}
            provenance={provenance("address", Boolean(initial.zip), Boolean(dirtyFields.zip))}
            error={errors.zip?.message}
            {...register("zip")}
          />
        </div>
        {extracted && <p className="muted small">{t("confirm.legend")}</p>}
        <button type="submit" className="btn btn--block" disabled={save.isPending}>
          {extracted ? t("confirm.correct") : t("confirm.save")}
        </button>
      </form>
      {(failed || !extracted) && (
        <button type="button" className="btn btn--secondary" onClick={() => navigate("/details")}>
          {t("details.tryAnother")}
        </button>
      )}
    </StepPage>
  );
}
