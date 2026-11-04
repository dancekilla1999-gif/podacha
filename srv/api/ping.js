// Ежедневный запрос к базе, чтобы бесплатный проект Supabase не уходил в паузу из-за неактивности.
module.exports = async function (req, res) {
  try {
    const r = await fetch("https://qozyihhlocvgpkchyqsp.supabase.co/rest/v1/rpc/pd_ping", {
      method: "POST",
      headers: { apikey: "sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov", "Content-Type": "application/json" },
      body: "{}"
    });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (e) {
    res.status(502).json({ ok: false });
  }
};
