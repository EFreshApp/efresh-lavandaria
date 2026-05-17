// ============================================================
// EFresh Lavandaria - API de criação de conta cliente
// Caminho no GitHub/Vercel: /api/auth-register.js
// ============================================================

export default async function handler(req, res) {
  // Permitir apenas POST
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método não permitido. Use POST."
    });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel."
      });
    }

    const body = req.body || {};

    const nome = String(body.nome || "").trim();
    const apelido = String(body.apelido || "").trim();
    const telefoneOriginal = String(body.telefone || "").trim();
    const password = String(body.password || "").trim();

    if (!nome) {
      return res.status(400).json({
        ok: false,
        error: "Nome obrigatório."
      });
    }

    if (!telefoneOriginal) {
      return res.status(400).json({
        ok: false,
        error: "Número de celular obrigatório."
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "A password deve ter pelo menos 6 caracteres."
      });
    }

    // Normalizar telefone
    // Aceita: 845178833, +258845178833, 258845178833
    let digits = telefoneOriginal.replace(/\D/g, "");

    if (digits.startsWith("258")) {
      digits = digits;
    } else if (digits.length === 9) {
      digits = "258" + digits;
    } else {
      return res.status(400).json({
        ok: false,
        error: "Número inválido. Use formato 84xxxxxxx ou +25884xxxxxxx."
      });
    }

    const telefoneComMais = "+" + digits;
    const emailInterno = `${digits}@efreshapp.com`;

    // ============================================================
    // 1. Criar usuário no Supabase Auth
    // ============================================================

    const createAuthResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        email: emailInterno,
        password: password,
        email_confirm: true,
        user_metadata: {
          nome,
          apelido,
          telefone: telefoneComMais,
          role: "cliente"
        }
      })
    });

    const authData = await createAuthResponse.json();

    if (!createAuthResponse.ok) {
      const msg =
        authData?.msg ||
        authData?.message ||
        authData?.error_description ||
        authData?.error ||
        "Erro ao criar usuário no Supabase Auth.";

      return res.status(createAuthResponse.status).json({
        ok: false,
        error: msg,
        details: authData
      });
    }

    const authUser = authData;

    if (!authUser || !authUser.id) {
      return res.status(500).json({
        ok: false,
        error: "Usuário criado, mas o Supabase não retornou ID.",
        details: authData
      });
    }

    // ============================================================
    // 2. Criar/atualizar perfil na tabela public.usuarios
    // ============================================================

    const usuarioPayload = {
      auth_user_id: authUser.id,
      nome,
      apelido,
      telefone: telefoneComMais,
      email: emailInterno,
      role: "cliente",
      activo: true
    };

    const upsertUsuarioResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?on_conflict=auth_user_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(usuarioPayload)
      }
    );

    const usuarioData = await upsertUsuarioResponse.json();

    if (!upsertUsuarioResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: "Usuário Auth criado, mas falhou ao criar perfil em public.usuarios.",
        details: usuarioData
      });
    }

    // ============================================================
    // 3. Criar/atualizar cliente na tabela public.clientes
    // ============================================================

    const clientePayload = {
      auth_user_id: authUser.id,
      nome,
      apelido,
      telefone: telefoneComMais,
      email: emailInterno,
      senha: "",
      activo: true
    };

    const upsertClienteResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes?on_conflict=telefone`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(clientePayload)
      }
    );

    const clienteData = await upsertClienteResponse.json();

    if (!upsertClienteResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: "Usuário criado, mas falhou ao criar cliente em public.clientes.",
        details: clienteData
      });
    }

    // ============================================================
    // 4. Resposta final
    // ============================================================

    return res.status(200).json({
      ok: true,
      message: "Conta criada com sucesso.",
      user: {
        id: authUser.id,
        email: emailInterno,
        telefone: telefoneComMais,
        nome,
        apelido,
        role: "cliente"
      },
      usuario: Array.isArray(usuarioData) ? usuarioData[0] : usuarioData,
      cliente: Array.isArray(clienteData) ? clienteData[0] : clienteData
    });

  } catch (error) {
    console.error("Erro em /api/auth-register:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Erro inesperado ao criar conta."
    });
  }
}
