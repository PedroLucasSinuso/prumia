package wallet

import (
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Funções usadas pelos outros domínios (receita, pagamento, categoria) para validar uma carteira recebida na entrada.
// Recebem o *gorm.DB (ou a transação) de quem chama e sempre filtram por household_id: uma carteira de outra casa
// é indistinguível de uma que não existe.

// CheckUsable confere que `id` é uma carteira ATIVA da casa; senão acrescenta o erro ao campo `field` (ex.: "walletId").
// Carteira arquivada não pode receber lançamentos novos, mas continua no histórico.
func CheckUsable(db *gorm.DB, householdID, id uuid.UUID, field string, v *validation.Collector) error {
	var w Wallet
	err := db.Select("id", "archived_at").Where("household_id = ? AND id = ?", householdID, id).First(&w).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		v.Add(field, "carteira inválida")
	case err != nil:
		return err
	case w.Archived():
		v.Add(field, "a carteira está arquivada")
	}
	return nil
}

// CheckSpendable é o CheckUsable para conta e receita (pagar uma invoice, receber uma receita, carteira padrão de
// categoria): além de ativa, a carteira não pode ser de investimento. Investimento só se move por transferência e ajuste.
func CheckSpendable(db *gorm.DB, householdID, id uuid.UUID, field string, v *validation.Collector) error {
	var w Wallet
	err := db.Select("id", "archived_at", "kind").Where("household_id = ? AND id = ?", householdID, id).First(&w).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		v.Add(field, "carteira inválida")
	case err != nil:
		return err
	case w.Archived():
		v.Add(field, "a carteira está arquivada")
	case w.IsInvestment():
		v.Add(field, "carteira de investimento não paga conta nem recebe receita: use uma transferência")
	}
	return nil
}

// DefaultID devolve a carteira padrão da casa (sempre existe: o banco garante uma só, e ela não é arquivável).
func DefaultID(db *gorm.DB, householdID uuid.UUID) (uuid.UUID, error) {
	var w Wallet
	if err := db.Select("id").Where("household_id = ? AND is_default", householdID).First(&w).Error; err != nil {
		return uuid.Nil, err
	}
	return w.ID, nil
}

// BenefitOrDefaultID é a carteira sugerida para receita do tipo benefício (VR): a ativa chamada "Benefício", se existir;
// senão a padrão da casa.
func BenefitOrDefaultID(db *gorm.DB, householdID uuid.UUID) (uuid.UUID, error) {
	var w Wallet
	err := db.Select("id").Where("household_id = ? AND archived_at IS NULL AND kind = 'regular' AND lower(name) = lower(?)", householdID, BenefitName).
		First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DefaultID(db, householdID)
	}
	return w.ID, err
}
