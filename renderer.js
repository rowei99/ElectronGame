//const electron = require('electron')
// $(This) file is requicreature3 by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in $(this) process.
//function card (cost, cssclass){;
//    this.cost = cost;
//    this.cssclass = cssclass;
//};
function card(cost, cssclass){
    this.cost = cost;
    this.cssclass = cssclass;
}/*function creature(cost, cssclass){
    this.cost = cost;
    this.cssclass = cssclass;
}function spell(cost, cssclass){
    this.cost = cost;
    this.cssclass = cssclass;
}*/
var creature1 = new card(2, "creature1");
var creature2 = new card(1, "creature2");
var creature3 = new card(3, "creature3");
var hand = ["empty","empty","empty","empty","empty"]
var table = ["empty","empty","empty","empty","empty"]
var mana = 10;
var deck = [creature1,creature1,creature1,creature1,creature1, creature2, creature2, creature2, creature2, creature3, creature2, creature3, creature3];
var shuffle = [];
var decklocation = 0;
var length = deck.length;
for (var i = 0; i < length; i++) {;
    var rand = Math.floor((Math.random() * deck.length));
    shuffle.push(deck[rand]);
    deck.splice(rand, 1);
};
var shuffle_length = shuffle.length
$("#end").click(function(){
    if(decklocation < shuffle_length){
        var done = false
        for(i = 1 ;i < 6 && done == false; i++){
            if($("#card" + i).hasClass("empty")){
                $("#card" + i).removeClass("empty")
                $("#card" + i).addClass(shuffle[decklocation].cssclass)
                hand[i - 1] = shuffle[decklocation]
                decklocation = decklocation + 1
                done = true
            }
        }
    console.log(hand)
    }
    mana = 10;    
    for(i = 0 ;i < 10; i++){
        if (i >= mana) {
            $("#mana" + i).removeClass()
            $("#mana" + i).addClass("manaused mana")
        }else{
            $("#mana" + i).removeClass()
            $("#mana" + i).addClass("mana")
        }
    }
});
$("#draw").click(function(){
    if(decklocation < shuffle_length){
        var done = false
        for(i = 1 ;i < 6 && done == false; i++){
            if($("#card" + i).hasClass("empty")){
                $("#card" + i).removeClass("empty")
                $("#card" + i).addClass(shuffle[decklocation].cssclass)
                hand[i - 1] = shuffle[decklocation]
                decklocation = decklocation + 1
                done = true
            }
        }
    console.log(hand)
    }
})
$(".card").click(function(){  
    var placenum = this.id.replace('card','')
    if(hand[placenum - 1].cost <= mana){
        table[placenum - 1] = hand[placenum - 1].cssclass
        $("#played" + placenum).removeClass()
        $("#played" + placenum).addClass(table[placenum - 1])
        $("#played" + placenum).addClass("played")
        $(this).removeClass(hand[placenum - 1].cssclass)
        $(this).addClass("empty")
        mana = mana - hand[placenum - 1].cost
        console.log(mana)
        hand[placenum - 1] = "empty"
    }
    for(i = 0 ;i < 10; i++){
        if (i >= mana) {
            $("#mana" + i).removeClass()
            $("#mana" + i).addClass("manaused mana")
        }
    }
});