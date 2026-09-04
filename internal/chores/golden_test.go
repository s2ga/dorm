package chores

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

const goldenPath = "../../tests/golden/chores_golden.json"

type memberDTO struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	CheckInDate  *string `json:"check_in_date"`
	CheckOutDate *string `json:"check_out_date"`
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func TestGoldenChores(t *testing.T) {
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("đọc %s: %v — chạy generator: node tests/golden/gen_chores_golden.js tests/golden/chores_golden.json", goldenPath, err)
	}
	var g struct {
		Schedule []struct {
			Name string `json:"name"`
			In   struct {
				Members []memberDTO `json:"members"`
				Today   string      `json:"today"`
				Weeks   int         `json:"weeks"`
			} `json:"in"`
			Out []Slot `json:"out"`
		} `json:"schedule"`
		MondayOf []struct {
			Name string `json:"name"`
			In   string `json:"in"`
			Out  string `json:"out"`
		} `json:"mondayOf"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("parse golden: %v", err)
	}

	for _, c := range g.Schedule {
		members := make([]Member, len(c.In.Members))
		for i, m := range c.In.Members {
			members[i] = Member{ID: m.ID, Name: m.Name, CheckInDate: str(m.CheckInDate), CheckOutDate: str(m.CheckOutDate)}
		}
		got := Schedule(members, c.In.Today, c.In.Weeks)
		if len(got) == 0 && len(c.Out) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("schedule [%s]\n  Go   = %+v\n  Node = %+v", c.Name, got, c.Out)
		}
	}
	for _, c := range g.MondayOf {
		if got := MondayOf(c.In); got != c.Out {
			t.Errorf("mondayOf [%s] Go=%s Node=%s", c.Name, got, c.Out)
		}
	}
}
