//const electron = require('electron')
// $(This) file is requicreature3 by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in $(this) process.
function card (cost){;
    this.cost = cost;
};
var creature1 = new card(2);
var creature2 = new card(1);
var creature3 = new card(3);
var hand = ["empty","empty","empty","empty","empty"]
var table = ["empty","empty","empty","empty","empty"]

var mana = 10;
var deck = ["creature1", "creature2", "creature2", "creature2", "creature2", "creature3", "creature2", "creature3", "creature3"];
var shuffle = [];
var decklocation = 0;
var length = deck.length;
for (var i = 0; i < length; i++) {;
    var rand = Math.floor((Math.random() * deck.length));
    shuffle.push(deck[rand]);
    deck.splice(rand, 1);
};
var shuffle_length = shuffle.length
$("#deck").click(function(){
    if(decklocation < shuffle_length){
        var done = false
        for(i = 1 ;i < 6 && done == false; i++){
            if($("#card" + i).hasClass("empty")){
                $("#card" + i).removeClass("empty")
                $("#card" + i).addClass(shuffle[decklocation])
                hand[i - 1] = shuffle[decklocation]
                decklocation = decklocation + 1
                done = true
            }
        }
    console.log(hand)
    }
});
$(".card").click(function(){
    var classlist = $(this).attr('class').split(/\s+/)
    //console.log(classlist)
    var transfer = classlist.indexOf("card")
    classlist.splice(transfer, 1)
    //console.log(classlist[0])
    var cardclass = classlist[0]
    var placenum = this.id.replace('card','')
    hand[placenum] = "empty"
    $("#played" + placenum).removeClass()
    $("#played" + placenum).addClass(cardclass)
    $("#played" + placenum).addClass("played")
    $(this).removeClass(cardclass)
    $(this).addClass("empty")
});