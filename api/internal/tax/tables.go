// Package tax estima INSS e IRRF de um salário mensal. É SÓ uma sugestão para preencher os descontos (que continuam
// opcionais e editáveis): o holerite manda. Não há API pública oficial para isso, então as tabelas ficam aqui,
// versionadas por ano, com as fontes oficiais e a data da conferência.
//
// Para atualizar num ano novo: copie o bloco do ano anterior, troque os números pelas tabelas oficiais e acrescente
// o caso de teste em estimate_test.go (valores conferidos à mão contra a tabela).
package tax

// Faixa de uma tabela progressiva. Valores em CENTAVOS; alíquotas em pontos-base (1 ponto-base = 0,01%, então
// 7,5% = 750). Inteiros evitam float em dinheiro.
type Band struct {
	UpToCents      int64 // limite superior da faixa (0 na última faixa = sem limite)
	RateBP         int64
	DeductionCents int64 // "parcela a deduzir" (só IRRF)
}

// Reduction é a redução do IRRF mensal da Lei 15.270/2025 (art. 3º-A da Lei 9.250/1995).
type Reduction struct {
	// Até FullUpToCents de rendimentos tributáveis: reduz o imposto até CapCents (na prática zera o imposto).
	FullUpToCents int64
	CapCents      int64
	// Entre FullUpToCents e ZeroFromCents: reduz BaseCents - FactorMicro/1e6 x rendimentos (decresce até zerar).
	ZeroFromCents int64
	BaseCents     int64
	FactorMicro   int64 // 0,133145 = 133145 milionésimos
}

// Table é a tabela de um ano.
type Table struct {
	Year int
	// INSS: faixas progressivas (cada faixa só incide sobre a parte do salário dentro dela). A última faixa é o teto.
	INSS []Band
	// IRRF: tabela progressiva mensal sobre a base de cálculo.
	IRRF []Band
	// DependentCents: dedução mensal por dependente.
	DependentCents int64
	// SimplifiedCents: desconto simplificado mensal (substitui INSS + dependentes quando for mais vantajoso).
	SimplifiedCents int64
	Reduction       *Reduction // nil = o ano não tem essa redução
	Sources         []string   // URLs oficiais conferidas
	CheckedOn       string     // quando foi a conferência (AAAA-MM-DD)
}

// tables: ano -> tabela. Acrescente o ano novo aqui.
var tables = map[int]Table{
	2026: {
		Year: 2026,
		// Portaria Interministerial MPS/MF nº 13, de 09/01/2026: 7,5% até 1.621,00; 9% até 2.902,84; 12% até 4.354,27; 14% até 8.475,55.
		INSS: []Band{
			{UpToCents: 162100, RateBP: 750},
			{UpToCents: 290284, RateBP: 900},
			{UpToCents: 435427, RateBP: 1200},
			{UpToCents: 847555, RateBP: 1400},
		},
		// Receita Federal, tabela mensal a partir de janeiro de 2026.
		IRRF: []Band{
			{UpToCents: 242880, RateBP: 0, DeductionCents: 0},
			{UpToCents: 282665, RateBP: 750, DeductionCents: 18216},
			{UpToCents: 375105, RateBP: 1500, DeductionCents: 39416},
			{UpToCents: 466468, RateBP: 2250, DeductionCents: 67549},
			{UpToCents: 0, RateBP: 2750, DeductionCents: 90873},
		},
		DependentCents:  18959,
		SimplifiedCents: 60720,
		// Lei 15.270/2025, art. 2º (novo art. 3º-A da Lei 9.250/1995): até R$ 5.000,00 a redução é de até R$ 312,89
		// (imposto zero); de R$ 5.000,01 a R$ 7.350,00 a redução é R$ 978,62 - 0,133145 x rendimentos; acima, nenhuma.
		// A redução é limitada ao imposto apurado pela tabela progressiva (§ 1º).
		Reduction: &Reduction{FullUpToCents: 500000, CapCents: 31289, ZeroFromCents: 735000, BaseCents: 97862, FactorMicro: 133145},
		Sources: []string{
			"https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal",
			"https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026",
			"https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15270.htm",
		},
		CheckedOn: "2026-10-23",
	},
}
