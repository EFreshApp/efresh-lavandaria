// ============================================================
// EFresh Lavandaria - API de criação de funcionário pelo Admin
// Caminho no GitHub/Vercel: /api/auth-create-user.js
// ============================================================

export default async function handler(req, res) {
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
    const role = String(body.role || "").trim().toLowerCase();

    const rolesPermitidos = ["admin", "financeiro", "operador", "motorista"];

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

    if (!rolesPermitidos.includes(role)) {
      return res.status(400).json({
        ok: false,
        error: "Função inválida. Use admin, financeiro, operador ou motorista."
      });
    }

    // Normalizar telefone
    // Aceita: 845178833, +258845178833, 258845178833
    let digits = telefoneOriginal.replace(/\D/g, "");

    if (digits.startsWith("258")) {
      // mantém
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
          role
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
    // 2. Criar/atualizar perfil em public.usuarios
    // ============================================================

    const usuarioPayload = {
      auth_user_id: authUser.id,
      nome,
      apelido,
      telefone: telefoneComMais,
      email: emailInterno,
      role,
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
    // 3. Se for motorista, também cria/atualiza tabela motoristas
    // ============================================================

    let motoristaData = null;

    if (role === "motorista") {
      const motoristaPayload = {
        auth_user_id: authUser.id,
        nome,
        telefone: telefoneComMais,
        activo: true
      };

      const upsertMotoristaResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/motoristas?on_conflict=telefone`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Prefer": "resolution=merge-duplicates,return=representation"
          },
          body: JSON.stringify(motoristaPayload)
        }
      );

      motoristaData = await upsertMotoristaResponse.json();

      if (!upsertMotoristaResponse.ok) {
        return res.status(500).json({
          ok: false,
          error: "Usuário criado, mas falhou ao criar motorista em public.motoristas.",
          details: motoristaData
        });
      }
    }

    // ============================================================
    // 4. Criar/atualizar tabela funcionarios
    // ============================================================

    const cargoTexto = role === "admin"
      ? "Administrador"
      : role === "financeiro"
      ? "Financeiro"
      : role === "motorista"
      ? "Motorista"
      : "Operador";

    const funcionarioPayload = {
      auth_user_id: authUser.id,
      nome,
      telefone: telefoneComMais,
      email: emailInterno,
      senha: "",
      cargo: cargoTexto,
      role,
      activo: true
    };

    const upsertFuncionarioResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/funcionarios?on_conflict=telefone`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(funcionarioPayload)
      }
    );

    const funcionarioData = await upsertFuncionarioResponse.json();

    if (!upsertFuncionarioResponse.ok) {
      return res.status(500).json({
        ok: false,
        error: "Usuário criado, mas falhou ao criar funcionário em public.funcionarios.",
        details: funcionarioData
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Funcionário criado com sucesso.",
      user: {
        id: authUser.id,
        email: emailInterno,
        telefone: telefoneComMais,
        nome,
        apelido,
        role
      },
      usuario: Array.isArray(usuarioData) ? usuarioData[0] : usuarioData,
      funcionario: Array.isArray(funcionarioData) ? funcionarioData[0] : funcionarioData,
      motorista: Array.isArray(motoristaData) ? motoristaData[0] : motoristaData
    });

  } catch (error) {
    console.error("Erro em /api/auth-create-user:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Erro inesperado ao criar funcionário."
    });
  }
}
