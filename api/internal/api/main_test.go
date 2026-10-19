package api

import (
	"os"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode) // sem o despejo de rotas do modo debug
	os.Exit(m.Run())
}
