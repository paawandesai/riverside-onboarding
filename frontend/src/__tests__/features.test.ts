import { joinAddress, splitAddress } from "../features/address";
import { ageOn, dobToIso, splitDob } from "../features/dob";
import { bookingIcs } from "../features/ics";
import { checkPhoto, MAX_UPLOAD_BYTES } from "../features/upload";
import { t } from "../i18n";

test("address split takes only parts that are clearly there", () => {
  expect(splitAddress("8986 CEDAR HOLLOW DR, WESTBURY PINES WI 53554")).toEqual({
    street: "8986 CEDAR HOLLOW DR",
    city: "WESTBURY PINES",
    state: "WI",
    zip: "53554",
  });
  expect(splitAddress("12 ELM ST, MAPLE GROVE, MN 55311-1234").zip).toBe("55311");
  expect(splitAddress("8986 CEDAR HOLLOW DR, WESTBURY PINES WI")).toMatchObject({ city: "WESTBURY PINES", state: "WI", zip: "" });
  expect(splitAddress("8986 CEDAR HOLLOW DR")).toEqual({ street: "8986 CEDAR HOLLOW DR", city: "", state: "", zip: "" });
  expect(splitAddress(null)).toEqual({ street: "", city: "", state: "", zip: "" });
  expect(joinAddress({ street: " 1 A St ", city: "Town", state: "wi", zip: "53554" })).toBe("1 A St, Town WI 53554");
});

test("date of birth parts must form a real date", () => {
  expect(dobToIso({ month: "2", day: "29", year: "2000" })).toBe("2000-02-29");
  expect(dobToIso({ month: "2", day: "29", year: "2001" })).toBeNull();
  expect(dobToIso({ month: "13", day: "1", year: "2000" })).toBeNull();
  expect(dobToIso({ month: "1", day: "1", year: "99" })).toBeNull();
  expect(splitDob("1961-12-05")).toEqual({ year: "1961", month: "12", day: "5" });
  expect(splitDob(null)).toEqual({ month: "", day: "", year: "" });
  expect(ageOn("2000-06-15", new Date(2018, 5, 14))).toBe(17);
  expect(ageOn("2000-06-15", new Date(2018, 5, 15))).toBe(18);
});

test("calendar file has the visit time and place only", () => {
  const ics = bookingIcs(
    { id: "b1", status: "booked", confirmation_code: "AB12CD34", slot: { id: 1, starts_at: "2026-10-20T14:20:00Z", duration_minutes: 40, visit_type: "in_person", clinician_label: "Dr. Example" } },
    "Clinic",
    "1 Road",
    new Date("2026-10-16T00:00:00Z"),
  );
  expect(ics).toContain("DTSTART:20261020T142000Z");
  expect(ics).toContain("DTEND:20261020T150000Z");
  expect(ics).toContain("LOCATION:1 Road");
  expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
});

test("photo checks: type and size before upload", () => {
  expect(checkPhoto(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  expect(checkPhoto(new File(["x"], "IMG_1.HEIC", { type: "" }))).toBeNull();
  expect(checkPhoto(new File(["x"], "a.gif", { type: "image/gif" }))).toBe(t("details.wrongType"));
  const big = new File(["x"], "a.png", { type: "image/png" });
  Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
  expect(checkPhoto(big)).toBe(t("details.tooBig"));
});

test("strings fill placeholders", () => {
  expect(t("steps.of", { n: 2, total: 5 })).toBe("Step 2 of 5");
});
