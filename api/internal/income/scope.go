package income

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

// sourceCut espelha `income_source_cuts`: o que o lote mudou na repetição, para o Desfazer voltar exatamente atrás.
// Mesmo desenho de recurrence_cuts (contas fixas); ver docs/developer-guide/series-generation.md.
type sourceCut struct {
	HouseholdID      uuid.UUID `gorm:"type:uuid"`
	SourceID         uuid.UUID `gorm:"type:uuid"`
	BatchDeletedAt   time.Time
	PreviousEndMonth caldate.Date // zero = NULL (sem fim)
	CutEndMonth      caldate.Date // zero = NULL (o corte excluiu a repetição inteira)
}

func (sourceCut) TableName() string { return "income_source_cuts" }

// Delete faz a exclusão lógica (dá para desfazer com Restore).
//
//   - scope=this: só este lançamento. O índice único inclui as excluídas, então a previsão nunca recria o mês.
//   - scope=following (receita que se repete): este e os seguintes que ainda NÃO contam como recebidos; recebidos nunca
//     somem em lote (inclusive este, se já estiver recebido). A repetição é encerrada no mês anterior ao primeiro excluído
//     (ou excluída, se não sobra nada antes), para o horizonte não recriar os meses.
//
// O lote inteiro recebe o MESMO deleted_at (um instante só, gerado aqui e gravado também em income_source_cuts): é assim
// que Restore(scope=following) sabe o que foi excluído junto e não ressuscita exclusões avulsas anteriores.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID, scope Scope) error {
	inc, err := s.find(ctx, householdID, id)
	if err != nil {
		return err
	}
	// Microssegundos: a precisão do timestamptz. Assim o valor em Go é idêntico ao que fica no banco.
	at := time.Now().UTC().Truncate(time.Microsecond)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if scope != ScopeFollowing || inc.SourceID == nil {
			return tx.Where("household_id = ? AND id = ?", householdID, id).Delete(&Income{}).Error
		}
		var src Source
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("household_id = ? AND id = ?", householdID, *inc.SourceID).First(&src).Error
		if err != nil {
			return err
		}
		var months []caldate.Date
		err = s.predicted(tx, src).Where("competence_month >= ?", inc.CompetenceMonth).Order("competence_month").Pluck("competence_month", &months).Error
		if err != nil {
			return err
		}
		if len(months) == 0 {
			return nil // este já está recebido e não há seguintes a receber: nada a excluir em lote
		}
		// Update (e não Delete) para gravar o nosso instante; o escopo do GORM já ignora as excluídas.
		err = s.predicted(tx, src).Where("competence_month >= ?", inc.CompetenceMonth).Update("deleted_at", at).Error
		if err != nil {
			return err
		}
		return endSourceBefore(tx, src, months[0], at)
	})
}

// endSourceBefore encerra a repetição no mês anterior a `cutMonth` (end_month só diminui). Se não sobra mês antes do
// início, a repetição inteira é excluída. Registra o corte em income_source_cuts (com o fim anterior) para o Desfazer.
func endSourceBefore(tx *gorm.DB, src Source, cutMonth caldate.Date, at time.Time) error {
	cut := sourceCut{HouseholdID: src.HouseholdID, SourceID: src.ID, BatchDeletedAt: at, PreviousEndMonth: src.EndMonth}
	where := "household_id = ? AND id = ?"
	if !cutMonth.After(src.StartMonth) {
		if err := tx.Model(&Source{}).Where(where, src.HouseholdID, src.ID).Update("deleted_at", at).Error; err != nil {
			return err
		}
		return tx.Create(&cut).Error
	}
	end := cutMonth.AddMonths(-1)
	if !src.EndMonth.IsZero() && !src.EndMonth.After(end) {
		return nil // já termina antes: o fim não muda, não há o que desfazer
	}
	cut.CutEndMonth = end
	err := tx.Model(&Source{}).Where(where, src.HouseholdID, src.ID).
		Updates(map[string]any{"end_month": end, "updated_at": gorm.Expr("now()")}).Error
	if err != nil {
		return err
	}
	return tx.Create(&cut).Error
}

// Restore desfaz a exclusão lógica. Com scope=following numa receita que se repete, desfaz o LOTE "este e os seguintes"
// a que ela pertence: restaura os da mesma repetição com mês maior ou igual e o MESMO deleted_at (exclusões avulsas
// anteriores têm outro instante e continuam excluídas) e devolve o fim (ou reativa) a repetição. Se a repetição mudou
// depois do lote, responde ErrSeriesChanged e nada muda.
func (s *Service) Restore(ctx context.Context, householdID, id uuid.UUID, scope Scope) (View, error) {
	var inc Income
	err := s.db.WithContext(ctx).Unscoped().Where("household_id = ? AND id = ?", householdID, id).First(&inc).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	if !inc.DeletedAt.Valid {
		return View{}, ErrNotDeleted
	}
	following := scope == ScopeFollowing && inc.SourceID != nil
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Unscoped().Model(&Income{}).Where("household_id = ?", householdID)
		if following {
			q = q.Where("source_id = ? AND competence_month >= ? AND deleted_at = ?", *inc.SourceID, inc.CompetenceMonth, inc.DeletedAt.Time)
		} else {
			q = q.Where("id = ? AND deleted_at IS NOT NULL", id)
		}
		if err := q.Update("deleted_at", nil).Error; err != nil {
			return err
		}
		if !following {
			return nil
		}
		return undoSourceCut(tx, inc)
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
}

// undoSourceCut desfaz o que endSourceBefore fez no lote: reativa a repetição ou devolve o fim anterior. Só se ela estiver
// exatamente como o lote a deixou; se mudou depois (ex.: outro corte mais cedo ainda não desfeito), ErrSeriesChanged.
func undoSourceCut(tx *gorm.DB, inc Income) error {
	var cut sourceCut
	res := tx.Where("household_id = ? AND source_id = ? AND batch_deleted_at = ?", inc.HouseholdID, *inc.SourceID, inc.DeletedAt.Time).
		Limit(1).Find(&cut)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return nil // o lote não mexeu na repetição (já terminava antes)
	}
	src := tx.Unscoped().Model(&Source{}).Where("household_id = ? AND id = ?", inc.HouseholdID, *inc.SourceID)
	var upd *gorm.DB
	if cut.CutEndMonth.IsZero() {
		upd = src.Where("deleted_at = ?", cut.BatchDeletedAt).Update("deleted_at", nil)
	} else {
		upd = src.Where("deleted_at IS NULL AND end_month = ?", cut.CutEndMonth).
			Updates(map[string]any{"end_month": nilIfZero(cut.PreviousEndMonth), "updated_at": gorm.Expr("now()")})
	}
	if upd.Error != nil {
		return upd.Error
	}
	if upd.RowsAffected == 0 {
		return ErrSeriesChanged
	}
	return tx.Where("household_id = ? AND source_id = ? AND batch_deleted_at = ?", inc.HouseholdID, *inc.SourceID, cut.BatchDeletedAt).
		Delete(&sourceCut{}).Error
}

// nilIfZero converte a data zero em NULL para o UPDATE (o tipo caldate.Date já faz isso em Value(), mas num map[string]any
// explicitar evita surpresa).
func nilIfZero(d caldate.Date) any {
	if d.IsZero() {
		return nil
	}
	return d
}
